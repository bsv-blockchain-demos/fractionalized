import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { connectToMongo, marketItemsCollection, propertiesCollection, listingBeefsCollection } from "../../../lib/mongo";
import { requireAuth } from "../../../utils/apiAuth";

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const userIdFromToken = auth.user;
  try {
    await connectToMongo();

    // Use authenticated user from token
    const userId = userIdFromToken;

    const cursor = marketItemsCollection.aggregate([
      { $match: { sellerId: userId, $or: [{ sold: { $exists: false } }, { sold: false }] } },
      {
        $lookup: {
          from: propertiesCollection.collectionName,
          localField: "propertyId",
          foreignField: "_id",
          as: "property",
        },
      },
      { $unwind: { path: "$property", preserveNullAndEmptyArrays: true } },
      // Join the listing's backed-up BEEF (listing_beefs.listingId is the market_item _id as a string).
      { $addFields: { listingIdStr: { $toString: "$_id" } } },
      {
        $lookup: {
          from: listingBeefsCollection.collectionName,
          localField: "listingIdStr",
          foreignField: "listingId",
          as: "listingBeefDoc",
        },
      },
      { $unwind: { path: "$listingBeefDoc", preserveNullAndEmptyArrays: true } },
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
          tokenTxid: "$property.txids.tokenTxid",
          // listingNonce used to derive the multisig keys (server's perspective stores it as keyId).
          keyId: 1,
          // The multisig outpoint being spent, plus its BEEF (for the client to build the cancel spend).
          listingOutpoint: "$listingBeefDoc.listingOutpoint",
          listingBeef: "$listingBeefDoc.beef",
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
      tokenTxid: i.tokenTxid ? String(i.tokenTxid) : undefined,
      // listingNonce (=keyId) so the seller can derive the multisig keys client-side.
      listingNonce: i.keyId ? String(i.keyId) : undefined,
      // The multisig outpoint to spend, and its BEEF (overlay-independent source tx).
      listingOutpoint: i.listingOutpoint ? String(i.listingOutpoint) : undefined,
      listingBeef: i.listingBeef ? String(i.listingBeef) : undefined,
    }));

    return NextResponse.json({ items: normalized });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
