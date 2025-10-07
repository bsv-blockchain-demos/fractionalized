import { connectToMongo, propertiesCollection, sharesCollection, locksCollection, Shares, marketItemsCollection } from "../../../lib/mongo";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { makeWallet } from "../../../lib/serverWallet";
import { PaymentUtxo } from "../../../utils/paymentUtxo";
import { Ordinals } from "../../../utils/ordinals";
import { broadcastTX, getTransactionByTxID } from "../../../hooks/overlayFunctions";
import { Transaction, TransactionSignature, Signature } from "@bsv/sdk";
import { traceShareChain } from "../../../utils/shareChain";
import { SERVER_PUBKEY } from "../../../utils/env";
import { toOutpoint } from "../../../utils/outpoints";
import { requireAuth } from "../../../utils/apiAuth";

const STORAGE_URL = process.env.STORAGE_URL;
const SERVER_PRIVATE_KEY = process.env.SERVER_PRIVATE_KEY;
const SERVER_PUB_KEY = SERVER_PUBKEY;

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

        if (!property?.txids?.tokenTxid || !property?.txids?.mintTxid) {
            throw new Error("Property token/payment UTXOs not initialized");
        }
        if (!property?.txids?.tokenTxid || !property?.txids?.mintTxid) {
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

        // Get the ordinal tx
        const ordinalTx = await getTransactionByTxID(share.transferTxid.split(".")[0]);
        if (!ordinalTx) {
            throw new Error("Failed to get transaction by txid");
        }

        const fullOrdinalTx = Transaction.fromBEEF(ordinalTx.outputs[0].beef as number[]);

        // Create ordinal transfer transaction scripts
        const ordinalTransferScript = new Ordinals().lock(buyerId, share.transferTxid.replace(".", "_"), property.txids.tokenTxid, share.amount, "transfer");

        // Payment unlocking will be signed against a preimage (frame-based)

        // Create pre-image transaction for ordinal unlock
        const preimageTx = new Transaction();
        preimageTx.addInput({
            sourceTransaction: fullOrdinalTx,
            sourceOutputIndex: 0,
        });
        preimageTx.addInput({
            sourceTransaction: paymentTX,
            sourceOutputIndex: 0,
        });
        preimageTx.addOutput({
            satoshis: 1,
            lockingScript: ordinalTransferScript,
        });

        const ordinalUnlockingFrame = new Ordinals().unlock(wallet, "single", false, 1, undefined, false, share.investorId);
        const ordinalUnlockingScript = await ordinalUnlockingFrame.sign(preimageTx, 0);

        // Create payment unlocking script using the same preimage and input index 1
        const paymentUnlockFrame = new PaymentUtxo().unlock(wallet, "all", false, undefined, undefined, buyerId);
        const paymentUnlockingScript = await paymentUnlockFrame.sign(preimageTx, 1);

        // Create transfer transaction
        const transferTx = await wallet.createAction({
            description: "Transfer share",
            inputBEEF: paymentTX.tx,
            inputs: [
                {
                    inputDescription: "Ordinal transfer",
                    outpoint: share.transferTxid,
                    unlockingScript: ordinalUnlockingScript.toHex(),
                },
                {
                    inputDescription: "Fee payment",
                    outpoint: toOutpoint(paymentTX.txid as string, 0),
                    unlockingScript: paymentUnlockingScript.toHex(),
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

        if (!transferTx) {
            throw new Error("Failed to create transfer transaction");
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