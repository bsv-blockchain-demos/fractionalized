import { propertiesCollection, Shares, sharesCollection, locksCollection } from "../../../lib/mongo";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { makeWallet } from "../../../lib/serverWallet";
import { Signature, TransactionSignature, UnlockingScript, PublicKey, Transaction } from "@bsv/sdk";
import { Ordinals } from "../../../utils/ordinals";
import { broadcastTX, getTransactionByTxID } from "../../../hooks/overlayFunctions";

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
        const paymentUnlockingScript = new UnlockingScript();
        paymentUnlockingScript
            .writeBin(sig.toChecksigFormat())
            .writeBin(PublicKey.fromString(SERVER_PUB_KEY).encode(true) as number[])
            .writeBin(PublicKey.fromString(property.seller).encode(true) as number[]);

        // Determine if this is the first transfer for this specific investor (lineage per investor)
        const lastShareForInvestor = await sharesCollection.find({ propertyId: propertyObjectId, investorId: investorObjectId })
            .sort({ createdAt: -1 })
            .limit(1)
            .toArray();
        const isFirstForInvestor = lastShareForInvestor.length === 0;
        // Current ordinal outpoint to spend: either the original mint outpoint, or the last transfer outpoint for this investor
        const currentOrdinalOutpoint = isFirstForInvestor ? property.txids.mintTxid : `${lastShareForInvestor[0].transferTxid}.0`;
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

        const assetId = property.txids.mintTxid.replace(".", "_");
        const ordinalTransferScript = new Ordinals().lock(investorId, assetId, amount, "transfer");

        // Also get the amount of tokens left from the actual ordinalTxLockingscript
        // Then calculate the token change to send back to the original mintTx

        // Create the transfer transaction
        const transferTx = await wallet.createAction({
            description: "Transfer share",
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
            outputs: [
                {
                    outputDescription: "Ordinal transfer",
                    satoshis: 1,
                    lockingScript: ordinalTransferScript.toHex(),
                }
            ],
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

        // Build share record, chaining parent/transfer txids to form a lineage
        const formattedShare: Shares = {
            _id: new ObjectId(),
            propertyId: propertyObjectId,
            investorId: investorObjectId,
            amount,
            parentTxid: isFirstForInvestor ? property.txids.mintTxid : (lastShareForInvestor[0].transferTxid as string),
            transferTxid: transferTx.txid as string,
            createdAt: new Date(),
            outpoint: `${transferTx.txid}.0`,
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