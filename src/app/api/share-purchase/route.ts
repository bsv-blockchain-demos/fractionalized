import { propertiesCollection, Shares, sharesCollection, locksCollection } from "../../../lib/mongo";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { makeWallet } from "../../../lib/serverWallet";
import { Signature, TransactionSignature, Transaction, LockingScript, Beef, Hash } from "@bsv/sdk";
import { Ordinals } from "../../../utils/ordinals";
import { broadcastTX, getTransactionByTxID } from "../../../hooks/overlayFunctions";
import { calcTokenTransfer } from "../../../hooks/calcTokenTransfer";
import { PaymentUTXO } from "../../../utils/paymentUtxo";

const STORAGE = process.env.STORAGE_URL;
const SERVER_KEY = process.env.SERVER_PRIVATE_KEY;
const SERVER_PUB_KEY = process.env.NEXT_PUBLIC_SERVER_PUB_KEY || "03817231c1ba7c6f244c294390d22d3f5bb81cb51dfc1eb165f6968e2455f18d39";

export async function POST(request: Request) {
    const { propertyId, investorId, amount } = await request.json();

    // Verify the purchase and make a blockchain transaction

    // Transfer 1satOrdinal from the property UTXO to the investor
    let lockId: ObjectId | null = null;
    try {
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
        const investorObjectId = new ObjectId(investorId);

        // Acquire per-(propertyId, investorId) lock; unique index enforces single holder
        try {
            const lockRes = await locksCollection.insertOne({
                _id: new ObjectId(),
                propertyId: propertyObjectId,
                investorId: investorObjectId,
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

        const { signature } = await wallet.createSignature({
            protocolID: [0, "ordinals"],
            keyID: "0",
            counterparty: 'self'
        });
        if (!signature) {
            throw new Error("Failed to create signature");
        }

        const rawSignature = Signature.fromDER(signature, 'hex')
        const sig = new TransactionSignature(
            rawSignature.r,
            rawSignature.s,
            TransactionSignature.SIGHASH_SINGLE
        );

        // Unlock the payment UTXO for the transaction fees
        const paymentUnlockingScript = new PaymentUTXO().unlock(sig, property.seller, SERVER_PUB_KEY);

        // Determine if this is the first transfer for this specific investor (lineage per investor)
        const lastShareForInvestor = await sharesCollection.find({ propertyId: propertyObjectId, investorId: investorObjectId })
            .sort({ createdAt: -1 })
            .limit(1)
            .toArray();

        const isFirstForInvestor = lastShareForInvestor.length === 0;

        // Current ordinal outpoint to spend: either the original mint outpoint, or the last transfer outpoint for this investor
        const currentOrdinalOutpoint = isFirstForInvestor ? property.txids.mintTxid : lastShareForInvestor[0].transferTxid;
        const [parentTxID, parentVoutStr] = String(currentOrdinalOutpoint).split('.');
        const parentVout = Number(parentVoutStr || '0');

        // Use overlay query with parentTxID to get full TX
        const response = await getTransactionByTxID(parentTxID);
        const txbeef = response?.outputs[0].beef;

        if (!response || !txbeef) {
            throw new Error("Failed to get transaction by txid");
        }

        const fullParentTx = Transaction.fromBEEF(txbeef as number[]);

        // Create the ordinal unlocking and locking script for transfer
        const ordinalUnlockingFrame = new Ordinals().unlock(wallet, "single", false, 1, undefined, isFirstForInvestor, property.seller);
        const ordinalUnlockingScript = await ordinalUnlockingFrame.sign(fullParentTx, parentVout);

        const assetId = currentOrdinalOutpoint.replace(".", "_");
        const ordinalTransferScript = new Ordinals().lock(investorId, assetId, propertyTokenTxid, amount, "transfer");

        // Also get the amount of tokens left from the actual ordinalTxLockingscript
        // Then calculate the token change to send back to the original mintTx
        const changeAmount = await calcTokenTransfer(fullParentTx, parentVout, amount);

        let changedOriginalTx: boolean = false;

        // Only allow change if it's from the original mintTx
        let changeScript: LockingScript | null = null;
        if (parentTxID === property.txids.mintTxid) {
            changeScript = new Ordinals().lock(
                property.seller,
                property.txids.mintTxid.replace(".", "_"),
                propertyTokenTxid,
                changeAmount,
                "transfer",
                false,
                true
            );
            changedOriginalTx = true;
        } else {
            if (changeAmount > 0) {
                throw new Error("You cannot purchase a share from a transfer");
            }
        }

        // Create new multiSig lockingScript for the payment change UTXO
        const oneOfTwoHash = Hash.hash160(SERVER_PUB_KEY + property.seller, "hex");
        const paymentChangeLockingScript = new PaymentUTXO().lock(oneOfTwoHash);

        const outputs: { outputDescription: string; satoshis: number; lockingScript: string }[] = [
            {
                outputDescription: "Ordinal transfer",
                satoshis: 1,
                lockingScript: ordinalTransferScript.toHex(),
            },
        ]; // TODO add change output which takes all remaining satoshis
        if (changeScript) {
            outputs.push({
                outputDescription: "Ordinal token change",
                satoshis: 1,
                lockingScript: changeScript.toHex(),
            });
        }

        // Query to overlay to get the TX beefs
        const ordParentTx = await getTransactionByTxID(parentTxID);
        if (!ordParentTx) {
            throw new Error("Failed to get transaction by txid");
        }
        const paymentTx = await getTransactionByTxID(property.txids.paymentTxid.split('.')[0]);
        if (!paymentTx) {
            throw new Error("Failed to get transaction by txid");
        }

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

        if (changedOriginalTx) {
            // The original token tx has changed because tokens have been spent
            // Update the original token tx
            const updateRes = await propertiesCollection.updateOne(
                { _id: propertyObjectId },
                { $set: { "txids.mintTxid": `${transferTx.txid}.1` } }
            );
            if (!updateRes.modifiedCount) {
                throw new Error("Failed to update original token tx");
            }
        }

        // TODO always update the payment utxo to the new payment change output

        // Build share record, chaining parent/transfer txids to form a lineage
        const formattedShare: Shares = {
            _id: new ObjectId(),
            propertyId: propertyObjectId,
            investorId: investorObjectId,
            amount,
            parentTxid: isFirstForInvestor ? property.txids.mintTxid : (lastShareForInvestor[0].transferTxid as string),
            transferTxid: `${transferTx.txid}.0`,
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
        } catch {}
    }
}