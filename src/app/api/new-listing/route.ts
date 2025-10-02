import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { propertiesCollection, sharesCollection, marketItemsCollection, Shares, MarketItem } from "../../../lib/mongo";
import { traceShareChain } from "../../../utils/shareChain";

const SERVER_PUB_KEY = process.env.NEXT_PUBLIC_SERVER_PUB_KEY || "03817231c1ba7c6f244c294390d22d3f5bb81cb51dfc1eb165f6968e2455f18d39";

export async function POST(request: Request) {
    const { propertyId, sellerId, amount, parentTxid, transferTxid, pricePerShare } = await request.json();

    try {
        if (!ObjectId.isValid(propertyId) || !ObjectId.isValid(sellerId)) {
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
        if (!property?.txids?.tokenTxid || !property?.txids?.mintTxid) {
            throw new Error("Property token/payment UTXOs not initialized");
        }

        const chainResult = await traceShareChain({ propertyId, leafTransferTxid: parentTxid });

        if (!chainResult.valid) {
            return NextResponse.json({ error: chainResult.reason }, { status: 400 });
        }

        const formattedShare: Shares = {
            _id: new ObjectId(),
            propertyId: propertyObjectId,
            investorId: `${sellerId}_${SERVER_PUB_KEY}`,
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
    }
}