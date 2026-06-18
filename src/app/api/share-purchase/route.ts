import { connectToMongo, propertiesCollection, Shares, sharesCollection, locksCollection } from "../../../lib/mongo";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { makeWallet } from "../../../lib/serverWallet";
import { Signature, TransactionSignature, Transaction, LockingScript, Beef, Hash, PublicKey, UnlockingScript, SatoshisPerKilobyte } from "@bsv/sdk";
import { OrdinalsP2PKH } from "../../../utils/ordinalsP2PKH";
import { OrdinalsP2MS } from "../../../utils/ordinalsP2MS";
import { broadcastTX, getTransactionByTxID } from "../../../hooks/overlayFunctions";
import { calcTokenTransfer } from "../../../hooks/calcTokenTransfer";
import { PaymentUtxo } from "../../../utils/paymentUtxo";
import { parseOutpoint, toOutpoint } from "../../../utils/outpoints";
import { requireAuth } from "../../../utils/apiAuth";
import { hashFromPubkeys } from "../../../utils/hashFromPubkeys";
import { generateNonce, deriveMultisigPair, deriveRecipientKey, getIdentityKey, TOKEN_PROTOCOL } from "../../../utils/tokenDerivation";
import { internalizeToBasket } from "../../../utils/internalizeToBasket";
import { encodeBeef } from "../../../utils/beefEncoding";
import { fetchTokenSourceTx } from "../../../utils/fetchTokenSourceTx";

const STORAGE = process.env.WALLET_STORAGE_URL;
const SERVER_KEY = process.env.SERVER_PRIVATE_KEY;

export async function POST(request: Request) {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const userId = auth.user;
    const { propertyId, investorId, amount } = await request.json();
    console.log("InvestorId", investorId)

    // Verify the investoryId (requester) is the logged in user
    if (userId !== investorId) {
        return NextResponse.json({ error: "You can't make a purchase for another user" }, { status: 403 });
    }

    // Verify the purchase and make a blockchain transaction

    // Transfer 1satOrdinal from the property UTXO to the investor
    let lockId: ObjectId | null = null;
    try {
        await connectToMongo();

        if (!SERVER_KEY || !STORAGE) {
            return NextResponse.json({ error: "Server wallet not configured" }, { status: 500 });
        }
        const wallet = await makeWallet("main", STORAGE as string, SERVER_KEY as string);
        if (!wallet) {
            throw new Error("Failed to create wallet");
        }
        const propertyObjectId = new ObjectId(propertyId);
        if (typeof investorId !== "string") {
            return NextResponse.json({ error: "Invalid investorId" }, { status: 400 });
        }

        if (amount <= 0) {
            return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
        } else if (amount > 100) {
            return NextResponse.json({ error: "Amount must be less than 100%" }, { status: 400 });
        } else if (typeof amount !== 'number') {
            return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
        }

        // Acquire per-(propertyId, investorId) lock; unique index enforces single holder
        try {
            const lockRes = await locksCollection.insertOne({
                _id: new ObjectId(),
                propertyId: propertyObjectId,
                investorId,
                createdAt: new Date(),
            });
            lockId = lockRes.insertedId;
        } catch (e: any) {
            // Duplicate key error => lock already held
            if (e?.code === 11000) {
                return NextResponse.json({ error: "Another transfer is in progress for this investor and property" }, { status: 409 });
            }
            throw e;
        }

        const property = await propertiesCollection.findOne({ _id: propertyObjectId });
        if (!property) {
            throw new Error("Property not found");
        }
        if (!property?.txids?.currentOutpoint || !property?.txids?.paymentTxid || !property?.txids?.originalMintTxid) {
            throw new Error("Property token UTXOs not initialized");
        }

        // Validate that purchase amount doesn't exceed available shares
        const percentToSell = property?.sell?.percentToSell;
        if (percentToSell != null) {
            // Use stored remainingPercent if available, otherwise calculate it
            let remainingPercent = property?.sell?.remainingPercent;
            if (remainingPercent == null) {
                const existingShares = await sharesCollection
                    .find({ propertyId: propertyObjectId })
                    .toArray();
                const totalSold = existingShares.reduce((sum, share) => sum + share.amount, 0);
                remainingPercent = percentToSell - totalSold;
            }

            // Validate purchase amount against remaining shares
            if (amount > remainingPercent) {
                return NextResponse.json(
                    { error: `Cannot purchase ${amount}% - only ${remainingPercent.toFixed(2)}% remaining` },
                    { status: 400 }
                );
            }
        }

        // Get property token txid to put in the inscribed token (for indentification)
        const propertyTokenTxid = property.txids.tokenTxid;

        // Payment unlocking will be signed against the preimage (frame-based)

        // Server's root identity key (counterparty value recipients/parties derive against)
        const serverIdentityKey = await getIdentityKey(wallet);

        // Spend from the current outpoint (either original mint or latest change output)
        const currentOrdinalOutpoint = property.txids.currentOutpoint as string;
        const { txid: parentTxID, vout: parentVout } = parseOutpoint(currentOrdinalOutpoint);

        // Resolve the ordinal source tx via carry-forward BEEF (falls back to overlay inside helper)
        const fullParentTx = await fetchTokenSourceTx(currentOrdinalOutpoint, property.currentDerivation?.beef);

        // Ordinal unlock: recorded type-42 derivation, else legacy.
        const cur = property.currentDerivation;
        const ordinalUnlockingFrame = cur?.keyId
            ? new OrdinalsP2MS().unlock(wallet, cur.keyId, cur.counterparty, cur.counterpartyDerivedKey,
                "single", true, undefined, undefined, cur.order === 'self-first', TOKEN_PROTOCOL)
            : new OrdinalsP2MS().unlock(wallet, "0", "self", property.seller, "single", true, undefined, undefined, false);

        // Payment unlock: recorded type-42 derivation, else legacy static key.
        // Legacy lock was [server, seller] (server first => firstPubkeyIsWallet=true).
        const pd = property.paymentDerivation;
        const paymentUnlockFrame = pd?.keyId
            ? new PaymentUtxo().unlock(
                /* wallet */ wallet,
                /* keyID */ pd.keyId,
                /* counterparty */ pd.counterparty,
                /* otherPubkey */ pd.counterpartyDerivedKey,
                /* signOutputs */ "single",
                /* anyoneCanPay */ true,
                /* sourceSatoshis */ undefined,
                /* lockingScript */ undefined,
                /* firstPubkeyIsWallet */ pd.order === 'self-first',
                /* protocolID */ TOKEN_PROTOCOL,
            )
            : new PaymentUtxo().unlock(
                /* wallet */ wallet,
                /* keyID */ "0",
                /* counterparty */ "self",
                /* otherPubkey */ property.seller,
                /* signOutputs */ "single",
                /* anyoneCanPay */ true,
                /* sourceSatoshis */ undefined,
                /* lockingScript */ undefined,
                /* firstPubkeyIsWallet */ true,
            );

        const assetId = currentOrdinalOutpoint.replace(".", "_");
        // Derive a per-output child key for the investor (only they can derive the matching private key)
        const transferNonce = generateNonce();
        const investorChild = await deriveRecipientKey(wallet, investorId, transferNonce);
        // Lock to the investor's derived child key.
        const investorPubKeyHash = Hash.hash160(investorChild, "hex") as number[];
        const ordinalTransferScript = new OrdinalsP2PKH().lock(
            /* address */ investorPubKeyHash,
            /* assetId */ assetId,
            /* tokenTxid */ propertyTokenTxid,
            /* shares */ amount,
            /* type */ "transfer"
        );

        // Also get the amount of tokens left from the actual ordinalTxLockingscript
        // Then calculate the token change to send back to the original mintTx
        const changeAmount = await calcTokenTransfer(fullParentTx, parentVout, amount);

        if (changeAmount < 0) {
            throw new Error("Not enough tokens to purchase");
        }
        // On the final sale (buying all remaining shares) there is no ordinal change.
        const hasOrdinalChange = changeAmount > 0;

        // Ordinal change: derived 1-of-2 multisig (server + seller).
        const changeNonce = generateNonce();
        const { selfKey: serverChangeChild, counterpartyKey: sellerChangeChild } = await deriveMultisigPair(wallet, property.seller, changeNonce);
        // Concat order [seller, server] (must match spend).
        const oneOfTwohashForChange = hashFromPubkeys([PublicKey.fromString(sellerChangeChild), PublicKey.fromString(serverChangeChild)]);

        const changeScript = new OrdinalsP2MS().lock(
            /* oneOfTwoHash */ oneOfTwohashForChange,
            /* assetId */ property.txids.originalMintTxid.replace(".", "_"),
            /* tokenTxid */ propertyTokenTxid,
            /* shares */ changeAmount,
            /* type */ "transfer"
        );

        // Payment source still via overlay (legacy); ordinal uses carry-forward above.
        const { txid: paymentTxID, vout: paymentVout } = parseOutpoint(property.txids.paymentTxid as string);
        const paymentTx = await getTransactionByTxID(paymentTxID);
        if (!paymentTx) {
            throw new Error("Failed to get transaction by txid");
        }

        // Payment CHANGE: derived 1-of-2 multisig (server + seller) at a FRESH nonce.
        // Committed order [seller, server] => server is self-second on its next spend.
        const changePaymentNonce = generateNonce();
        const { selfKey: serverPaymentChangeChild, counterpartyKey: sellerPaymentChangeChild } = await deriveMultisigPair(wallet, property.seller, changePaymentNonce);
        const oneOfTwoHash = hashFromPubkeys([PublicKey.fromString(sellerPaymentChangeChild), PublicKey.fromString(serverPaymentChangeChild)]);
        const paymentChangeLockingScript = new PaymentUtxo().lock(/* oneOfTwoHash */ oneOfTwoHash);

        const paymentSourceTX = Transaction.fromBEEF(paymentTx.outputs[0].beef as number[]);

        // Build a preimage transaction mirroring the final spend for correct signatures
        const preimageTx = new Transaction();
        preimageTx.addInput({
            sourceTransaction: fullParentTx,
            sourceOutputIndex: parentVout,
            unlockingScriptTemplate: ordinalUnlockingFrame,
        });
        preimageTx.addInput({
            sourceTransaction: paymentSourceTX,
            sourceOutputIndex: paymentVout,
            unlockingScriptTemplate: paymentUnlockFrame,
        });
        preimageTx.addOutput({
            satoshis: 1,
            lockingScript: ordinalTransferScript,
        });
        if (hasOrdinalChange) {
            preimageTx.addOutput({
                satoshis: 1,
                lockingScript: changeScript,
            });
        }
        // Track our payment-change index explicitly — the wallet may append its own
        // inputs/outputs in the real tx, so we can't assume it's the last output.
        const paymentChangeIndex = hasOrdinalChange ? 2 : 1;
        preimageTx.addOutput({
            change: true,
            lockingScript: paymentChangeLockingScript,
        });

        await preimageTx.fee(new SatoshisPerKilobyte(100))
        await preimageTx.sign()

        console.log('[Share-Purchase] Transaction to sign: ', preimageTx.toHex())

        // fee() drops the payment change when the pool can't cover it (e.g. a final sale draining it).
        const paymentChangeOutput = preimageTx.outputs[paymentChangeIndex];
        const hasPaymentChange = !!paymentChangeOutput;
        const paymentChangeSats = (paymentChangeOutput?.satoshis as number) ?? 0;

        // Get unlocking script lengths from preimage transaction
        const ordinalUnlockingScript = preimageTx.inputs[0].unlockingScript as UnlockingScript;
        const paymentUnlockingScript = preimageTx.inputs[1].unlockingScript as UnlockingScript;
        const ordinalUnlockingScriptLength = ordinalUnlockingScript.toHex().length / 2;
        const paymentUnlockingScriptLength = paymentUnlockingScript.toHex().length / 2;

        const outputs: { outputDescription: string; satoshis: number; lockingScript: string }[] = [
            {
                outputDescription: "Ordinal transfer",
                satoshis: 1,
                lockingScript: ordinalTransferScript.toHex(),
            },
        ];
        if (hasOrdinalChange) {
            outputs.push({
                outputDescription: "Ordinal token change",
                satoshis: 1,
                lockingScript: changeScript.toHex(),
            });
        }
        if (hasPaymentChange) {
            outputs.push({
                outputDescription: "Payment change",
                satoshis: paymentChangeSats,
                lockingScript: paymentChangeLockingScript.toHex(),
            });
        }

        // Merge the two input beefs required for the inputBEEF
        const beef = new Beef();
        beef.mergeBeef(fullParentTx.toBEEF());
        beef.mergeBeef(paymentTx.outputs[0].beef);

        // Create the transfer transaction with unlockingScriptLength
        const actionRes = await wallet.createAction({
            description: "Transfer share",
            inputBEEF: beef.toBinary(),
            inputs: [
                {
                    inputDescription: "Ordinal transfer",
                    outpoint: currentOrdinalOutpoint,
                    unlockingScriptLength: ordinalUnlockingScriptLength,
                },
                {
                    inputDescription: "Payment",
                    outpoint: property.txids.paymentTxid,
                    unlockingScriptLength: paymentUnlockingScriptLength,
                }
            ],
            outputs,
            options: {
                randomizeOutputs: false,
                acceptDelayedBroadcast: false,
            }
        })

        if (!actionRes?.signableTransaction) {
            throw new Error("Failed to create signable transaction");
        }

        const reference = actionRes.signableTransaction.reference;
        const txToSign = Transaction.fromBEEF(actionRes.signableTransaction.tx);

        // Add unlocking script templates to inputs (reuse frames from preimage)
        txToSign.inputs[0].unlockingScriptTemplate = ordinalUnlockingFrame;
        txToSign.inputs[0].sourceTransaction = fullParentTx;
        txToSign.inputs[1].unlockingScriptTemplate = paymentUnlockFrame;
        txToSign.inputs[1].sourceTransaction = paymentSourceTX;

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

        // Broadcast the transfer transaction to the Overlay for later lookup
        const tx = Transaction.fromBEEF(transferTx.tx as number[]);
        const overlayResponse = await broadcastTX(tx);

        if (overlayResponse.status !== "success") {
            console.log(`Failed to broadcast transaction for ${transferTx.txid}`);
        }

        const atomicBeef = transferTx.tx as number[];
        const set: Record<string, unknown> = {};

        if (hasOrdinalChange) {
            // Record the ordinal change (output 1) in the server basket; counterparty = seller.
            await internalizeToBasket(wallet, atomicBeef, [{
                outputIndex: 1, keyId: changeNonce, counterparty: property.seller,
                counterpartyDerivedKey: sellerChangeChild, order: 'self-second', tags: ['type:share'],
            }], "Share change (server side)");

            // Advance currentOutpoint to the ordinal change; carry derivation + BEEF for its next spend.
            set["txids.currentOutpoint"] = toOutpoint(transferTx.txid as string, 1);
            set["currentDerivation"] = {
                keyId: changeNonce,
                counterparty: property.seller,
                counterpartyDerivedKey: sellerChangeChild,
                order: 'self-second',
                beef: encodeBeef(atomicBeef),
            };
        }
        // Final sale (no ordinal change): leave currentOutpoint as-is; status → funded below.
        if (hasPaymentChange) {
            set["txids.paymentTxid"] = toOutpoint(transferTx.txid as string, paymentChangeIndex);
            set["paymentDerivation"] = {
                keyId: changePaymentNonce,
                counterparty: property.seller,
                counterpartyDerivedKey: sellerPaymentChangeChild,
                order: 'self-second',
            };
        }
        if (Object.keys(set).length > 0) {
            await propertiesCollection.updateOne({ _id: propertyObjectId }, { $set: set });
        }

        // Check if this investor already has shares for this property
        const existingInvestorShares = await sharesCollection.findOne({
            propertyId: propertyObjectId,
            investorId,
        });
        const isNewInvestor = !existingInvestorShares;

        // Build share record; parent is the outpoint we spent from (currentOutpoint before update)
        const formattedShare: Shares = {
            _id: new ObjectId(),
            propertyId: propertyObjectId,
            investorId,
            amount,
            parentTxid: currentOrdinalOutpoint,
            transferTxid: toOutpoint(transferTx.txid as string, 0),
            createdAt: new Date(),
            // Investor's single-sig P2PKH derivation: they unlock with counterparty = server identity
            keyId: transferNonce,
            counterparty: serverIdentityKey,
        }
        const share = await sharesCollection.insertOne(formattedShare);

        // Atomically update remainingPercent, investor count, and check if fully funded
        if (percentToSell != null) {
            const newRemainingPercent = (property?.sell?.remainingPercent ?? percentToSell) - amount;
            const updateFields: any = {
                "sell.remainingPercent": newRemainingPercent
            };

            // Update status to "funded" if all shares are sold
            if (newRemainingPercent <= 0) {
                updateFields.status = "funded";
            }

            // Increment investor count only if this is a new investor
            const updateOperation: any = { $set: updateFields };
            if (isNewInvestor) {
                updateOperation.$inc = { investors: 1 };
            }

            await propertiesCollection.updateOne(
                { _id: propertyObjectId },
                updateOperation
            );
        } else if (isNewInvestor) {
            // If no percentToSell tracking, still increment investor count for new investors
            await propertiesCollection.updateOne(
                { _id: propertyObjectId },
                { $inc: { investors: 1 } }
            );
        }

        return NextResponse.json({
            share,
            isNewInvestor,
            received: { atomicBeef: encodeBeef(atomicBeef), outputIndex: 0, keyId: transferNonce, counterparty: serverIdentityKey },
        });
    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    } finally {
        // Release lock
        try {
            if (lockId) {
                await locksCollection.deleteOne({ _id: lockId });
            }
        } catch { }
    }
}