import { NextResponse } from "next/server";
  import { ObjectId } from "mongodb";
  import { connectToMongo, sharesCollection } from "../../../lib/mongo";
  import { traceShareChain } from "../../../utils/shareChain";

  export async function POST(request: Request) {
    const { propertyId, leafTransferTxid, investorId } = await request.json();

    try {
      await connectToMongo();

      if (!propertyId) {
        return NextResponse.json({ error: "propertyId is required" }, { status: 400 });
      }

      let leaf = leafTransferTxid as string | undefined;

      // If no leaf given, resolve from latest share for investor
      if (!leaf) {
        if (!investorId) {
          return NextResponse.json({ error: "Provide leafTransferTxid or investorId" }, { status: 400 });
        }
        const propertyObjectId = new ObjectId(propertyId);
        const lastShare = await sharesCollection
          .find({ propertyId: propertyObjectId, investorId })
          .sort({ createdAt: -1 })
          .limit(1)
          .toArray();
        if (!lastShare.length) {
          return NextResponse.json({ error: "No shares found for investor on this property" }, { status: 404 });
        }
        leaf = lastShare[0].transferTxid as string;
      }

      const result = await traceShareChain({
        propertyId,
        leafTransferTxid: leaf!,
      });
      return NextResponse.json(result);
    } catch (e) {
      console.error(e);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }
