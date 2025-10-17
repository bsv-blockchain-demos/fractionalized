import { connectToMongo, propertiesCollection, Shares, sharesCollection, locksCollection } from "../../../lib/mongo";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { makeWallet } from "../../../lib/serverWallet";
import { Signature, TransactionSignature, Transaction, LockingScript, Beef, Hash } from "@bsv/sdk";
import { Ordinals } from "../../../utils/ordinalsP2PKH";
import { broadcastTX, getTransactionByTxID } from "../../../hooks/overlayFunctions";
import { calcTokenTransfer } from "../../../hooks/calcTokenTransfer";
import { PaymentUtxo } from "../../../utils/paymentUtxo";
import { SERVER_PUBKEY } from "../../../utils/env";
import { parseOutpoint, toOutpoint } from "../../../utils/outpoints";
import { requireAuth } from "../../../utils/apiAuth";

const STORAGE = process.env.STORAGE_URL;
const SERVER_KEY = process.env.SERVER_PRIVATE_KEY;
const SERVER_PUB_KEY = SERVER_PUBKEY;

export async function POST(request: Request) {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const userId = auth.user;
    const { propertyId, investorId, amount } = await request.json();

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
        const wallet = await makeWallet("main", SERVER_KEY as string, STORAGE as string);
        if (!wallet) {
            throw new Error("Failed to create wallet");
        }
        const propertyObjectId = new ObjectId(propertyId);
        if (!ObjectId.isValid(investorId)) {
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
        if (!property?.txids?.mintTxid || !property?.txids?.paymentTxid) {
            throw new Error("Property token UTXOs not initialized");
        }

        // Get property token txid to put in the inscribed token (for indentification)
        const propertyTokenTxid = property.txids.tokenTxid;

        // Payment unlocking will be signed against the preimage (frame-based)

        // Always spend from the original mint outpoint for purchases
        const currentOrdinalOutpoint = property.txids.mintTxid as string;
        const { txid: parentTxID, vout: parentVout } = parseOutpoint(currentOrdinalOutpoint);

        // Use overlay query with parentTxID to get full TX
        const response = await getTransactionByTxID(parentTxID);
        const txbeef = response?.outputs[0].beef;

        if (!response || !txbeef) {
            throw new Error("Failed to get transaction by txid");
        }

        const fullParentTx = Transaction.fromBEEF(txbeef as number[]);

        // Create the ordinal unlocking and locking script for transfer (mint spend => treat as first)
        const ordinalUnlockingFrame = new Ordinals().unlock(wallet, "single", false, 1, undefined, true, property.seller);

        const assetId = currentOrdinalOutpoint.replace(".", "_");
        const ordinalTransferScript = new Ordinals().lock(investorId, assetId, propertyTokenTxid, amount, "transfer");

        // Also get the amount of tokens left from the actual ordinalTxLockingscript
        // Then calculate the token change to send back to the original mintTx
        const changeAmount = await calcTokenTransfer(fullParentTx, parentVout, amount);

        if (changeAmount < 0) {
            throw new Error("Not enough tokens to purchase");
        }

        // Only allow change if it's from the original mint outpoint
        const changeScript = new Ordinals().lock(
            property.seller,
            property.txids.mintTxid.replace(".", "_"),
            propertyTokenTxid,
            changeAmount,
            "transfer",
            false,
            true
        );

        // Query to overlay to get the TX beefs
        const ordParentTx = await getTransactionByTxID(parentTxID);
        if (!ordParentTx) {
            throw new Error("Failed to get transaction by txid");
        }

        const { txid: paymentTxID, vout: paymentVout } = parseOutpoint(property.txids.paymentTxid as string);
        const paymentTx = await getTransactionByTxID(paymentTxID);
        if (!paymentTx) {
            throw new Error("Failed to get transaction by txid");
        }

        // Create new multiSig lockingScript for the payment change UTXO
        const oneOfTwoHash = Hash.hash160(SERVER_PUB_KEY + property.seller, "hex");
        const paymentChangeLockingScript = new PaymentUtxo().lock(oneOfTwoHash);

        const paymentSourceTX = Transaction.fromBEEF(paymentTx.outputs[0].beef as number[]);
        const paymentChangeSats = Number(paymentSourceTX.outputs[paymentVout].satoshis) - 2; // 2 satoshis for fees

        const outputs: { outputDescription: string; satoshis: number; lockingScript: string }[] = [
            {
                outputDescription: "Ordinal transfer",
                satoshis: 1,
                lockingScript: ordinalTransferScript.toHex(),
            },
            {
                outputDescription: "Ordinal token change",
                satoshis: 1,
                lockingScript: changeScript.toHex(),
            },
            {
                outputDescription: "Payment change",
                satoshis: paymentChangeSats,
                lockingScript: paymentChangeLockingScript.toHex(),
            },
        ];

        // Build a preimage transaction mirroring the final spend for correct signatures
        const preimageTx = new Transaction();
        preimageTx.addInput({
            sourceTransaction: fullParentTx,
            sourceOutputIndex: parentVout,
        });
        preimageTx.addInput({
            sourceTransaction: paymentSourceTX,
            sourceOutputIndex: paymentVout,
        });
        preimageTx.addOutput({
            satoshis: 1,
            lockingScript: ordinalTransferScript,
        });
        preimageTx.addOutput({
            satoshis: 1,
            lockingScript: changeScript,
        });
        preimageTx.addOutput({
            satoshis: paymentChangeSats,
            lockingScript: paymentChangeLockingScript,
        });

        // Sign the ordinal input (index 0) and payment input (index 1) against the preimage transaction
        const ordinalUnlockingScript = await ordinalUnlockingFrame.sign(preimageTx, 0);
        const paymentUnlockFrame = new PaymentUtxo().unlock(wallet, "single", false, undefined, undefined, property.seller);
        const paymentUnlockingScript = await paymentUnlockFrame.sign(preimageTx, 1);

        // Merge the two input beefs required for the inputBEEF
        const beef = new Beef();
        beef.mergeBeef(ordParentTx.outputs[0].beef);
        beef.mergeBeef(paymentTx.outputs[0].beef);

        // Create the transfer transaction
        const transferTx = await wallet.createAction({
            description: "Transfer share",
            inputBEEF: beef.toBinary(),
            inputs: [
                {
                    inputDescription: "Ordinal transfer",
                    outpoint: currentOrdinalOutpoint,
                    unlockingScript: ordinalUnlockingScript.toHex(),
                },
                {
                    inputDescription: "Payment",
                    outpoint: property.txids.paymentTxid,
                    unlockingScript: paymentUnlockingScript.toHex(),
                }
            ],
            outputs,
            options: {
                randomizeOutputs: false,
            }
        })

        if (!transferTx) {
            throw new Error("Failed to create transfer transaction");
        }

        // Broadcast the transfer transaction to the Overlay for later lookup
        const tx = Transaction.fromBEEF(transferTx.tx as number[]);
        const overlayResponse = await broadcastTX(tx);

        if (overlayResponse.status !== "success") {
            console.log(`Failed to broadcast transaction for ${transferTx.txid}`);
        }

        // The original token tx has changed because tokens have been spent
        // Update the original token tx
        const updateRes = await propertiesCollection.updateOne(
            { _id: propertyObjectId },
            { $set: { "txids.mintTxid": toOutpoint(transferTx.txid as string, 1), "txids.paymentTxid": toOutpoint(transferTx.txid as string, 2) } }
        );
        if (!updateRes.modifiedCount) {
            throw new Error("Failed to update original token tx");
        }

        // Build share record; parent is always the original mint outpoint for purchases
        const formattedShare: Shares = {
            _id: new ObjectId(),
            propertyId: propertyObjectId,
            investorId,
            amount,
            parentTxid: property.txids.mintTxid,
            transferTxid: toOutpoint(transferTx.txid as string, 0),
            createdAt: new Date(),
        }
        const share = await sharesCollection.insertOne(formattedShare);
        return NextResponse.json({ share });
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