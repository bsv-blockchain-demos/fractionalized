import { connectToMongo, propertiesCollection, sharesCollection, locksCollection, Shares, marketItemsCollection, listingBeefsCollection } from "../../../lib/mongo";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { makeWallet } from "../../../lib/serverWallet";
import { PaymentUtxo } from "../../../utils/paymentUtxo";
import { OrdinalsP2PKH } from "../../../utils/ordinalsP2PKH";
import { OrdinalsP2MS } from "../../../utils/ordinalsP2MS";
import { broadcastTX, getTransactionByTxID } from "../../../hooks/overlayFunctions";
import { Transaction, TransactionSignature, Signature, Hash, SatoshisPerKilobyte, UnlockingScript, Beef } from "@bsv/sdk";
import { traceShareChain } from "../../../utils/shareChain";
import { toOutpoint, parseOutpoint } from "../../../utils/outpoints";
import { requireAuth } from "../../../utils/apiAuth";
import { fetchTokenSourceTx } from "../../../utils/fetchTokenSourceTx";
import { generateNonce, deriveRecipientKey, deriveMultisigPair, getIdentityKey, TOKEN_PROTOCOL } from "../../../utils/tokenDerivation";
import { encodeBeef } from "../../../utils/beefEncoding";

const STORAGE_URL = process.env.WALLET_STORAGE_URL;
const SERVER_PRIVATE_KEY = process.env.SERVER_PRIVATE_KEY;

export async function POST(request: Request) {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const userId = auth.user;
    const { marketItemId, buyerId, paymentNonce, paymentTX } = await request.json();

    // Verify the investoryId (requester) is the logged in user
    if (userId !== buyerId) {
        return NextResponse.json({ error: "You can't make a purchase for another user" }, { status: 403 });
    }

    let lockId: ObjectId | null = null;
    try {
        await connectToMongo();

        const wallet = await makeWallet("main", STORAGE_URL as string, SERVER_PRIVATE_KEY as string);

        // Fetch all necessary data from marketItem collection -> share collection -> property collection
        const marketItem = await marketItemsCollection.findOne({ _id: new ObjectId(marketItemId) });
        if (!marketItem) {
            throw new Error("Market item not found");
        }
        const share = await sharesCollection.findOne({ _id: new ObjectId(marketItem.shareId) });
        if (!share) {
            throw new Error("Share not found");
        }
        const property = await propertiesCollection.findOne({ _id: new ObjectId(share.propertyId) });
        if (!property) {
            throw new Error("Property not found");
        }

        const propertyObjectId = new ObjectId(property._id);

        if (!property?.txids?.tokenTxid || (!property?.txids?.originalMintTxid && !property?.txids?.mintTxid)) {
            throw new Error("Property token/payment UTXOs not initialized");
        }

        // Trace chain of share before proceeding
        const traceRes = await traceShareChain({propertyId: propertyObjectId, leafTransferTxid: share.transferTxid});
        if (!traceRes) {
            throw new Error("Invalid share");
        }

        // Acquire lock per (property, buyer)
        try {
            const lockRes = await locksCollection.insertOne({
                _id: new ObjectId(),
                propertyId: propertyObjectId,
                investorId: buyerId,
                createdAt: new Date(),
            });
            lockId = lockRes.insertedId;
        } catch (e: any) {
            if (e?.code === 11000) {
                return NextResponse.json({ error: "Another transfer is in progress for this seller and property" }, { status: 409 });
            }
            throw e;
        }

        // Resolve the listing's source tx from the DB backup (listing_beefs), falling back to overlay.
        const { txid: ordinalTxid, vout: ordinalVout } = parseOutpoint(share.transferTxid);
        const beefDoc = await listingBeefsCollection.findOne({ listingId: marketItemId });
        const fullOrdinalTx = await fetchTokenSourceTx(share.transferTxid, beefDoc?.beef);

        const serverIdentityKey = await getIdentityKey(wallet);

        // Derive the buyer's P2PKH key at a fresh nonce (server is sender; only buyer can derive priv).
        const buyNonce = generateNonce();
        const buyerChild = await deriveRecipientKey(wallet, buyerId, buyNonce);

        // Create ordinal transfer transaction scripts
        // Lock to the buyer's DERIVED P2PKH key hash.
        const buyerPubKeyHash = Hash.hash160(buyerChild, "hex") as number[];
        const ordinalTransferScript = new OrdinalsP2PKH().lock(
            /* address */ buyerPubKeyHash,
            /* assetId */ share.transferTxid.replace(".", "_"),
            /* tokenTxid */ property.txids.tokenTxid,
            /* shares */ share.amount,
            /* type */ "transfer"
        );

        // Payment unlocking will be signed against a preimage (frame-based)

        // Server spends the listing multisig by deriving against the seller; legacy listings use the self/0 form.
        const ordinalUnlockingFrame = marketItem.keyId
            ? new OrdinalsP2MS().unlock(
                /* wallet */ wallet,
                /* keyID */ marketItem.keyId,
                /* counterparty */ marketItem.counterparty as string,
                /* otherPubkey */ marketItem.counterpartyDerivedKey as string,
                /* signOutputs */ "single",
                /* anyoneCanPay */ true,
                /* sourceSatoshis */ undefined,
                /* lockingScript */ undefined,
                /* firstPubkeyIsWallet */ marketItem.order === 'self-first',
                /* protocolID */ TOKEN_PROTOCOL,
            )
            : new OrdinalsP2MS().unlock(
                /* wallet */ wallet,
                /* keyID */ "0",
                /* counterparty */ "self",
                /* otherPubkey */ share.investorId,
                /* signOutputs */ "single",
                /* anyoneCanPay */ true,
                /* sourceSatoshis */ undefined,
                /* lockingScript */ undefined,
                /* firstPubkeyIsWallet */ true
            );

        // Spend the buyer's fee payment via its derived key.
        // Client locked [buyerChild, serverChild] (buyer first) => server is self-second (firstPubkeyIsWallet=false).
        const { counterpartyKey: buyerPaymentChild } = await deriveMultisigPair(wallet, buyerId, paymentNonce);
        const paymentUnlockFrame = new PaymentUtxo().unlock(
            /* wallet */ wallet,
            /* keyID */ paymentNonce,
            /* counterparty */ buyerId,
            /* otherPubkey */ buyerPaymentChild,
            /* signOutputs */ "single",
            /* anyoneCanPay */ true,
            /* sourceSatoshis */ undefined,
            /* lockingScript */ undefined,
            /* firstPubkeyIsWallet */ false,
            /* protocolID */ TOKEN_PROTOCOL,
        );

        const ordinalUnlockingScriptLength = await ordinalUnlockingFrame.estimateLength();
        const paymentUnlockingScriptLength = await paymentUnlockFrame.estimateLength();

        // Merge the two input beefs required for the inputBEEF
        const beef = new Beef();
        beef.mergeBeef(fullOrdinalTx.toBEEF());
        beef.mergeBeef(paymentTX.tx);

        // Create transfer transaction with unlockingScriptLength
        const actionRes = await wallet.createAction({
            description: "Transfer share",
            inputBEEF: beef.toBinary(),
            inputs: [
                {
                    inputDescription: "Ordinal transfer",
                    outpoint: share.transferTxid,
                    unlockingScriptLength: ordinalUnlockingScriptLength,
                },
                {
                    inputDescription: "Fee payment",
                    outpoint: toOutpoint(paymentTX.txid as string, 0),
                    unlockingScriptLength: paymentUnlockingScriptLength,
                }
            ],
            outputs: [
                {
                    outputDescription: "Ordinal transfer",
                    satoshis: 1,
                    lockingScript: ordinalTransferScript.toHex(),
                },
            ],
            options: {
                randomizeOutputs: false,
                acceptDelayedBroadcast: false,
            }
        });

        if (!actionRes?.signableTransaction) {
            throw new Error("Failed to create signable transaction");
        }

        const reference = actionRes.signableTransaction.reference;
        const txToSign = Transaction.fromBEEF(actionRes.signableTransaction.tx);

        // Add unlocking script templates to inputs (reuse frames from preimage)
        txToSign.inputs[0].unlockingScriptTemplate = ordinalUnlockingFrame;
        txToSign.inputs[0].sourceTransaction = fullOrdinalTx;
        txToSign.inputs[1].unlockingScriptTemplate = paymentUnlockFrame;
        txToSign.inputs[1].sourceTransaction = paymentTX;

        // Sign the complete transaction
        await txToSign.sign();

        // Extract the unlocking scripts
        const finalOrdinalUnlockingScript = txToSign.inputs[0].unlockingScript?.toHex();
        const finalPaymentUnlockingScript = txToSign.inputs[1].unlockingScript?.toHex();

        if (!finalOrdinalUnlockingScript || !finalPaymentUnlockingScript) {
            throw new Error("Missing unlocking scripts");
        }

        // Sign the action with the actual unlocking scripts
        const transferTx = await wallet.signAction({
            reference,
            spends: {
                "0": { unlockingScript: finalOrdinalUnlockingScript },
                "1": { unlockingScript: finalPaymentUnlockingScript }
            }
        });

        if (!transferTx?.txid) {
            throw new Error("Failed to sign transfer transaction");
        }

        const fullTransferTx = Transaction.fromBEEF(transferTx.tx as number[]);

        // Broadcast transfer transaction
        const broadcastRes = await broadcastTX(fullTransferTx);
        if (!broadcastRes) {
            throw new Error("Failed to broadcast transfer transaction");
        }

        // Update shares collection. Buyer's P2PKH: keyId=buyNonce, counterparty=server (buyer unlocks against server).
        const formattedShare: Shares = {
            _id: new ObjectId(),
            propertyId: propertyObjectId,
            investorId: buyerId,
            amount: marketItem.sellAmount,
            parentTxid: share.transferTxid,
            transferTxid: toOutpoint(transferTx.txid as string, 0),
            createdAt: new Date(),
            keyId: buyNonce,
            counterparty: serverIdentityKey,
        };
        const shareRes = await sharesCollection.insertOne(formattedShare);
        if (!shareRes.insertedId) {
            throw new Error("Failed to create share");
        }

        // Listing consumed: drop its BEEF backup.
        await listingBeefsCollection.deleteOne({ listingId: marketItemId });

        // Update listing
        const listingRes = await marketItemsCollection.updateOne({ _id: new ObjectId(marketItemId) }, { $set: { sold: true } }, { upsert: true });
        if (!listingRes.modifiedCount) {
            throw new Error("Failed to update listing");
        }

        return NextResponse.json({
            status: "success",
            received: {
                atomicBeef: encodeBeef(transferTx.tx as number[]),
                outputIndex: 0,
                keyId: buyNonce,
                counterparty: serverIdentityKey,
            },
        }, { status: 200 });
    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    } finally {
        try {
            if (lockId) {
                await locksCollection.deleteOne({ _id: lockId });
            }
        } catch { }
    }
}