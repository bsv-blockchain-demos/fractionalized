import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { connectToMongo, propertiesCollection, sharesCollection, marketItemsCollection, locksCollection, listingBeefsCollection, Shares } from "../../../lib/mongo";
import { requireAuth } from "../../../utils/apiAuth";
import { Transaction } from "@bsv/sdk";
import { makeWallet } from "../../../lib/serverWallet";
import { getIdentityKey } from "../../../utils/tokenDerivation";
import { decodeBeef } from "../../../utils/beefEncoding";
import { parseOutpoint, toOutpoint } from "../../../utils/outpoints";

const STORAGE = process.env.WALLET_STORAGE_URL;
const SERVER_KEY = process.env.SERVER_PRIVATE_KEY;

export async function POST(request: Request) {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const userIdFromToken = auth.user;
    const { marketItemId, returnTxid, cancelBeef, cancelNonce } = await request.json();

    let lockId: ObjectId | null = null;
    try {
        await connectToMongo();

        if (!marketItemId || !ObjectId.isValid(marketItemId)) {
            return NextResponse.json({ error: "Invalid market item id" }, { status: 400 });
        }
        if (!returnTxid || !cancelBeef || !cancelNonce) {
            return NextResponse.json({ error: "Missing cancel tx/derivation" }, { status: 400 });
        }

        const marketItem = await marketItemsCollection.findOne({ _id: new ObjectId(marketItemId) });
        if (!marketItem) {
            return NextResponse.json({ error: "Market item not found" }, { status: 404 });
        }

        // Identity check: only the listing's seller can cancel it.
        if (marketItem.sellerId !== userIdFromToken) {
            return NextResponse.json({ error: "You can't cancel someone else's listing" }, { status: 403 });
        }

        const share = await sharesCollection.findOne({ _id: new ObjectId(marketItem.shareId) });
        if (!share) {
            return NextResponse.json({ error: "Listing share not found" }, { status: 404 });
        }
        const property = await propertiesCollection.findOne({ _id: new ObjectId(marketItem.propertyId) });
        if (!property) {
            return NextResponse.json({ error: "Property not found" }, { status: 404 });
        }

        // The listing multisig outpoint is the listing share's transferTxid.
        const listingOutpoint = share.transferTxid;
        const { txid: listingTxid, vout: listingVout } = parseOutpoint(listingOutpoint);

        // Validate the client-built cancel tx: it must spend the listing multisig outpoint
        // and produce a 1-sat ordinal output at index 0.
        let cancelTx: Transaction;
        try {
            cancelTx = Transaction.fromBEEF(decodeBeef(cancelBeef));
        } catch {
            return NextResponse.json({ error: "Invalid cancel beef" }, { status: 400 });
        }

        const spendsListing = cancelTx.inputs.some(
            (i) => (i.sourceTXID || i.sourceTransaction?.id('hex')) === listingTxid && i.sourceOutputIndex === listingVout
        );
        if (!spendsListing) {
            return NextResponse.json({ error: "Cancel tx does not spend the listing multisig" }, { status: 400 });
        }
        if (cancelTx.outputs[0]?.satoshis !== 1) {
            return NextResponse.json({ error: "Cancel tx output 0 must be a 1-sat ordinal" }, { status: 400 });
        }

        // Server identity key the reclaimed P2PKH was locked toward (counterparty for the seller's
        // forSelf:true derivation). Derive server-side for trust; matches what share-purchase stores.
        let serverIdentityKey: string;
        if (SERVER_KEY && STORAGE) {
            const wallet = await makeWallet("main", STORAGE as string, SERVER_KEY as string);
            serverIdentityKey = await getIdentityKey(wallet);
        } else {
            return NextResponse.json({ error: "Server wallet not configured" }, { status: 500 });
        }

        // Acquire lock per (property, seller)
        const propertyObjectId = new ObjectId(marketItem.propertyId);
        try {
            const lockRes = await locksCollection.insertOne({
                _id: new ObjectId(),
                propertyId: propertyObjectId,
                investorId: marketItem.sellerId,
                createdAt: new Date(),
            });
            lockId = lockRes.insertedId;
        } catch (e: any) {
            if (e?.code === 11000) {
                return NextResponse.json({ error: "Another transfer is in progress for this seller and property" }, { status: 409 });
            }
            throw e;
        }

        // Record the reclaimed self-custody holding. Parent is the listing outpoint we spent.
        // Same shape as a purchased/invested holding: keyId=cancelNonce, counterparty=server identity.
        const reclaimedShare: Shares = {
            _id: new ObjectId(),
            propertyId: propertyObjectId,
            investorId: marketItem.sellerId,
            amount: marketItem.sellAmount,
            parentTxid: listingOutpoint,
            transferTxid: toOutpoint(returnTxid as string, 0),
            createdAt: new Date(),
            keyId: cancelNonce,
            counterparty: serverIdentityKey,
        };
        const shareRes = await sharesCollection.insertOne(reclaimedShare);
        if (!shareRes.insertedId) {
            throw new Error("Failed to record reclaimed share");
        }

        // Remove the listing from the active marketplace (listings/my-listings filter sold=false|missing).
        await listingBeefsCollection.deleteOne({ listingId: marketItemId });
        await marketItemsCollection.deleteOne({ _id: new ObjectId(marketItemId) });

        return NextResponse.json({
            status: "success",
            received: {
                outputIndex: 0,
                keyId: cancelNonce,
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
