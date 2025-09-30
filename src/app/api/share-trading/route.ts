import { propertiesCollection, sharesCollection, locksCollection, Shares } from "../../../lib/mongo";
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
    const { propertyId, sellerId, buyerId, amount } = await request.json();

    // REFACTOR: this is for trading among users only, the buyerId (the currently connected user with WalletClient)
    // should be the one creating a new paymentUTXO and sending it directly here in the request in hex form

    let lockId: ObjectId | null = null;
    try {
        if (!SERVER_KEY || !STORAGE) {
        }
        const wallet = await makeWallet("main", SERVER_KEY as string, STORAGE as string);
        if (!wallet) {
            throw new Error("Failed to create wallet");
        }

        if (!ObjectId.isValid(propertyId) || !ObjectId.isValid(sellerId) || !ObjectId.isValid(buyerId)) {
            return NextResponse.json({ error: "Invalid ids" }, { status: 400 });
        }
        if (typeof amount !== 'number' || amount <= 0) {
            return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
        }

        const propertyObjectId = new ObjectId(propertyId);
        const sellerObjectId = new ObjectId(sellerId);
        const buyerObjectId = new ObjectId(buyerId);

        // Acquire lock per (property, seller)
        try {
            const lockRes = await locksCollection.insertOne({
                _id: new ObjectId(),
                propertyId: propertyObjectId,
                investorId: sellerObjectId,
                createdAt: new Date(),
            });
            lockId = lockRes.insertedId;
        } catch (e: any) {
            if (e?.code === 11000) {
                return NextResponse.json({ error: "Another transfer is in progress for this seller and property" }, { status: 409 });
            }
            throw e;
        }

        const property = await propertiesCollection.findOne({ _id: propertyObjectId });
        if (!property) {
            throw new Error("Property not found");
        }
        if (!property?.txids?.paymentTxid || !property?.txids?.tokenTxid || !property?.txids?.mintTxid) {
            throw new Error("Property token/payment UTXOs not initialized");
        }
        const propertyTokenTxid = property.txids.tokenTxid;

        // Signature for payment UTXO spend
        const { signature } = await wallet.createSignature({
            protocolID: [0, "ordinals"],
            keyID: "0",
            counterparty: 'self'
        });
        if (!signature) {
            throw new Error("Failed to create signature");
        }
        const rawSignature = Signature.fromDER(signature, 'hex');
        const sig = new TransactionSignature(
            rawSignature.r,
            rawSignature.s,
            TransactionSignature.SIGHASH_SINGLE
        );
        const paymentUnlockingScript = new PaymentUTXO().unlock(sig, property.seller, SERVER_PUB_KEY);

        // Determine seller's latest transfer outpoint to spend (never mint)
        const lastSellerShare = await sharesCollection.find({ propertyId: propertyObjectId, investorId: sellerObjectId })
            .sort({ createdAt: -1 })
            .limit(1)
            .toArray();
        if (lastSellerShare.length === 0) {
            return NextResponse.json({ error: "Seller has no share to trade" }, { status: 400 });
        }
        const currentOrdinalOutpoint = lastSellerShare[0].transferTxid as string;
        if (currentOrdinalOutpoint === property.txids.mintTxid) {
            return NextResponse.json({ error: "Trading from mint outpoint is not allowed" }, { status: 400 });
        }

        const [parentTxID, parentVoutStr] = String(currentOrdinalOutpoint).split('.');
        const parentVout = Number(parentVoutStr || '0');

        // Fetch beefs for ordinal parent and payment UTXO
        const ordParentTx = await getTransactionByTxID(parentTxID);
        if (!ordParentTx || !ordParentTx.outputs?.[0]?.beef) {
            throw new Error("Failed to get transaction by txid for ordinal parent");
        }
        const paymentTx = await getTransactionByTxID(property.txids.paymentTxid.split('.')[0]);
        if (!paymentTx || !paymentTx.outputs?.[0]?.beef) {
            throw new Error("Failed to get transaction by txid for payment utxo");
        }

        // Build scripts
        const fullParentTx = Transaction.fromBEEF(ordParentTx.outputs[0].beef as number[]);
        const ordinalUnlockingFrame = new Ordinals().unlock(wallet, "single", false, 1, undefined, false, property.seller);
        const ordinalUnlockingScript = await ordinalUnlockingFrame.sign(fullParentTx, parentVout);

        const assetId = currentOrdinalOutpoint.replace(".", "_");
        const buyerLockingScript = new Ordinals().lock(buyerId, assetId, propertyTokenTxid, amount, "transfer");

        const changeAmount = await calcTokenTransfer(fullParentTx, parentVout, amount);

        if (changeAmount < 0) {
            throw new Error("Not enough tokens to trade");
        }

        let changeScript: LockingScript | null = null;
        if (changeAmount > 0) {
            changeScript = new Ordinals().lock(
                sellerId,
                assetId,
                propertyTokenTxid,
                changeAmount,
                "transfer",
                false,
                true
            );
        }

        const outputs: { outputDescription: string; satoshis: number; lockingScript: string }[] = [
            {
                outputDescription: "Ordinal transfer to buyer",
                satoshis: 1,
                lockingScript: buyerLockingScript.toHex(),
            },
        ];
        if (changeScript) {
            outputs.push({
                outputDescription: "Ordinal token change to seller",
                satoshis: 1,
                lockingScript: changeScript.toHex(),
            });
        }

        // Merge beefs and create action
        const beef = new Beef();
        beef.mergeBeef(ordParentTx.outputs[0].beef);
        beef.mergeBeef(paymentTx.outputs[0].beef);

        const transferTx = await wallet.createAction({
            description: "Trade share",
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
        });
        if (!transferTx) {
            throw new Error("Failed to create transfer transaction");
        }

        const tx = Transaction.fromBEEF(transferTx.tx as number[]);
        const overlayResponse = await broadcastTX(tx);
        if (overlayResponse.status !== "success") {
            console.log(`Failed to broadcast transaction for ${transferTx.txid}`);
        }

        const formattedShare: Shares = {
            _id: new ObjectId(),
            propertyId: propertyObjectId,
            investorId: buyerObjectId,
            amount,
            parentTxid: currentOrdinalOutpoint,
            transferTxid: `${transferTx.txid}.0`,
            createdAt: new Date(),
        };
        const share = await sharesCollection.insertOne(formattedShare);
        return NextResponse.json({ share });
    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    } finally {
        try {
            if (lockId) {
                await locksCollection.deleteOne({ _id: lockId });
            }
        } catch {}
    }
}