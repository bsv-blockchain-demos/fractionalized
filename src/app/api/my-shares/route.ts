import { NextResponse } from "next/server";
import { connectToMongo, sharesCollection } from "../../../lib/mongo";
import { requireAuth } from "../../../utils/apiAuth";

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const userIdFromToken = auth.user; // pubkey
  try {
    await connectToMongo();

    // Use pubkey from token
    const investorPubKey = userIdFromToken;

    // Return only shares currently owned by the user: shares for this investor pubkey
    // where there is no other share with parentTxid equal to this share's transferTxid
    const pipeline = [
      { $match: { investorId: investorPubKey } },
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
