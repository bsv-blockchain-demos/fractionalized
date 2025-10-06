import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { connectToMongo, sharesCollection } from "../../../lib/mongo";

export async function POST(request: Request) {
  try {
    await connectToMongo();

    const body = await request.json().catch(() => ({}));
    const userId: string | undefined = body.userId || body.investorId;

    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }
    if (!ObjectId.isValid(userId)) {
      return NextResponse.json({ error: "Invalid userId" }, { status: 400 });
    }
    const investorObjectId = new ObjectId(userId);

    // Return only shares currently owned by the user: shares for this investor
    // where there is no other share with parentTxid equal to this share's transferTxid
    const pipeline = [
      { $match: { investorId: investorObjectId } },
      {
        $lookup: {
          from: "shares",
          localField: "transferTxid",
          foreignField: "parentTxid",
          as: "children",
        },
      },
      { $match: { $expr: { $eq: [{ $size: "$children" }, 0] } } },
      { $project: { children: 0 } },
      { $sort: { createdAt: -1 } },
    ];

    const shares = await sharesCollection.aggregate(pipeline).toArray();
    return NextResponse.json({ shares });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
