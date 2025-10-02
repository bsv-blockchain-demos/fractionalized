import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { marketItemsCollection, propertiesCollection } from "../../../lib/mongo";

export async function POST(request: Request) {
  try {
    const { userId } = await request.json();
    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    const cursor = marketItemsCollection.aggregate([
      {
        $match: {
          sellerId: userId,
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
    ]);

    const items = await cursor.toArray();
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

    return NextResponse.json({ items: normalized });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
