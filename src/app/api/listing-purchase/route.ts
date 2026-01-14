import { connectToMongo, propertiesCollection, sharesCollection, locksCollection, Shares, marketItemsCollection } from "../../../lib/mongo";
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

const STORAGE_URL = process.env.STORAGE_URL;
const SERVER_PRIVATE_KEY = process.env.SERVER_PRIVATE_KEY;

export async function POST(request: Request) {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const userId = auth.user;
    const { marketItemId, buyerId, paymentTX } = await request.json();

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

        // Get the ordinal tx and parse the vout
        const { txid: ordinalTxid, vout: ordinalVout } = parseOutpoint(share.transferTxid);
        const ordinalTx = await getTransactionByTxID(ordinalTxid);
        if (!ordinalTx) {
            throw new Error("Failed to get transaction by txid");
        }

        const fullOrdinalTx = Transaction.fromBEEF(ordinalTx.outputs[0].beef as number[]);

        // Create ordinal transfer transaction scripts
        // Hash the public key to get pubKeyHash for P2PKH locking script
        const buyerPubKeyHash = Hash.hash160(buyerId, "hex") as number[];
        const ordinalTransferScript = new OrdinalsP2PKH().lock(
            /* address */ buyerPubKeyHash,
            /* assetId */ share.transferTxid.replace(".", "_"),
            /* tokenTxid */ property.txids.tokenTxid,
            /* shares */ share.amount,
            /* type */ "transfer"
        );

        // Payment unlocking will be signed against a preimage (frame-based)

        // Create unlocking frames
        const ordinalUnlockingFrame = new OrdinalsP2MS().unlock(
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

        const paymentUnlockFrame = new PaymentUtxo().unlock(
            /* wallet */ wallet,
            /* otherPubkey */ buyerId,
            /* signOutputs */ "single",
            /* anyoneCanPay */ true,
        );

        // Create pre-image transaction for signing
        const preimageTx = new Transaction();
        preimageTx.addInput({
            sourceTransaction: fullOrdinalTx,
            sourceOutputIndex: ordinalVout,
            sequence: 0xffffffff,
            unlockingScriptTemplate: ordinalUnlockingFrame,
        });
        preimageTx.addInput({
            sourceTransaction: paymentTX,
            sourceOutputIndex: 0,
            sequence: 0xffffffff,
            unlockingScriptTemplate: paymentUnlockFrame,
        });
        preimageTx.addOutput({
            satoshis: 1,
            lockingScript: ordinalTransferScript,
        });

        // Sign the preimage transaction
        await preimageTx.fee(new SatoshisPerKilobyte(100));
        await preimageTx.sign();

        // Extract the unlocking scripts and get their lengths
        const ordinalUnlockingScript = preimageTx.inputs[0].unlockingScript as UnlockingScript;
        const paymentUnlockingScript = preimageTx.inputs[1].unlockingScript as UnlockingScript;
        const ordinalUnlockingScriptLength = ordinalUnlockingScript.toHex().length / 2;
        const paymentUnlockingScriptLength = paymentUnlockingScript.toHex().length / 2;

        // Merge the two input beefs required for the inputBEEF
        const beef = new Beef();
        beef.mergeBeef(ordinalTx.outputs[0].beef);
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

        // Update shares collection
        const formattedShare: Shares = {
            _id: new ObjectId(),
            propertyId: propertyObjectId,
            investorId: buyerId,
            amount: marketItem.sellAmount,
            parentTxid: share.transferTxid,
            transferTxid: toOutpoint(transferTx.txid as string, 0),
            createdAt: new Date(),
        };
        const shareRes = await sharesCollection.insertOne(formattedShare);
        if (!shareRes.insertedId) {
            throw new Error("Failed to create share");
        }

        // Update listing
        const listingRes = await marketItemsCollection.updateOne({ _id: new ObjectId(marketItemId) }, { $set: { sold: true } }, { upsert: true });
        if (!listingRes.modifiedCount) {
            throw new Error("Failed to update listing");
        }

        return NextResponse.json({ status: "success" }, { status: 200 });
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