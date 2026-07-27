import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { connectToMongo, marketItemsCollection, propertiesCollection } from "../../../lib/mongo";
import { requireAuth } from "../../../utils/apiAuth";
import { logger } from "../../../utils/logger";

export async function GET(request: Request) {
    try {
        const auth = await requireAuth(request);
        if (auth instanceof NextResponse) return auth;

        const { searchParams } = new URL(request.url);
        const page = Number(searchParams.get("page") || 1);
        const limit = Number(searchParams.get("limit") || 20);
        const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
        const safePage = Math.max(1, Number(page) || 1);
        const skip = Math.max(0, (safePage - 1) * safeLimit);

        await connectToMongo();

        // Find unsold listings (sold: false OR missing)
        const cursor = marketItemsCollection.aggregate([
            {
                $match: {
                    $or: [
                        { sold: { $exists: false } },
                        { sold: false },
                    ],
                },
            },
            {
                $lookup: {
                    from: propertiesCollection.collectionName,
                    localField: "propertyId",
                    foreignField: "_id",
                    as: "property",
                },
            },
            { $unwind: { path: "$property", preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id: 1,
                    propertyId: 1,
                    sellerId: 1,
                    shareId: 1,
                    sellAmount: 1,
                    pricePerShare: 1,
                    createdAt: 1,
                    name: { $ifNull: ["$property.title", "Unknown Property"] },
                    location: { $ifNull: ["$property.location", "Unknown"] },
                },
            },
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: safeLimit },
        ]);

        const items = await cursor.toArray();
        // Normalize ids to strings for the client
        const normalized = items.map((i: any) => ({
            _id: String(i._id),
            propertyId: String(i.propertyId instanceof ObjectId ? i.propertyId : i.propertyId),
            sellerId: String(i.sellerId),
            shareId: String(i.shareId),
            sellAmount: Number(i.sellAmount ?? 0),
            pricePerShare: Number(i.pricePerShare ?? 0),
            name: String(i.name ?? "Unknown Property"),
            location: String(i.location ?? "Unknown"),
          }));

        return NextResponse.json({ items: normalized, page: safePage, limit: safeLimit });
    } catch (e) {
        logger.error(e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}