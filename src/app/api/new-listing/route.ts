import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { connectToMongo, propertiesCollection, sharesCollection, marketItemsCollection, locksCollection, Shares, MarketItem } from "../../../lib/mongo";
import { requireAuth } from "../../../utils/apiAuth";
import { traceShareChain } from "../../../utils/shareChain";

export async function POST(request: Request) {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const userIdFromToken = auth.user;
    const { propertyId, sellerId, amount, parentTxid, transferTxid, pricePerShare } = await request.json();

    // Identity check: a user can only create listings for themselves
    if (sellerId !== userIdFromToken) {
        return NextResponse.json({ error: "You can't create listings for someone else" }, { status: 403 });
    }

    let lockId: ObjectId | null = null;
    try {
        await connectToMongo();

        if (!ObjectId.isValid(propertyId)) {
            return NextResponse.json({ error: "Invalid ids" }, { status: 400 });
        }
        if (typeof amount !== 'number' || amount <= 0) {
            return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
        }

        const propertyObjectId = new ObjectId(propertyId);

        const property = await propertiesCollection.findOne({ _id: propertyObjectId });
        if (!property) {
            throw new Error("Property not found");
        }
        if (!property?.txids?.tokenTxid || (!property?.txids?.originalMintTxid && !property?.txids?.mintTxid)) {
            throw new Error("Property token/payment UTXOs not initialized");
        }

        // Acquire lock per (property, seller)
        try {
            const lockRes = await locksCollection.insertOne({
                _id: new ObjectId(),
                propertyId: propertyObjectId,
                investorId: sellerId,
                createdAt: new Date(),
            });
            lockId = lockRes.insertedId;
        } catch (e: any) {
            if (e?.code === 11000) {
                return NextResponse.json({ error: "Another transfer is in progress for this seller and property" }, { status: 409 });
            }
            throw e;
        }

        const chainResult = await traceShareChain({ propertyId, leafTransferTxid: parentTxid });

        if (!chainResult.valid) {
            return NextResponse.json({ error: chainResult.reason }, { status: 400 });
        }

        const formattedShare: Shares = {
            _id: new ObjectId(),
            propertyId: propertyObjectId,
            investorId: sellerId,
            amount,
            parentTxid,
            transferTxid,
            createdAt: new Date(),
        };
        const share = await sharesCollection.insertOne(formattedShare);

        // Create listing
        const marketItem: MarketItem = {
            _id: new ObjectId(),
            propertyId: propertyObjectId,
            sellerId,
            shareId: share.insertedId,
            sellAmount: amount,
            pricePerShare,
            createdAt: new Date(),
        };
        const listing = await marketItemsCollection.insertOne(marketItem);

        return NextResponse.json({ share, listing });
    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    } finally {
        if (lockId) {
            await locksCollection.deleteOne({ _id: lockId });
        }
    }
}