import { NextResponse } from "next/server";
import { connectToMongo, sharesCollection } from "../../../lib/mongo";
import { requireAuth } from "../../../utils/apiAuth";
import { readJsonBody } from "../../../utils/validation";
import { verifyRequestProof } from "../../../utils/apiAuthProof";
import { AUTH_PROOF_PURPOSE } from "../../../lib/authProofPurposes";
import { logger } from "../../../utils/logger";

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await readJsonBody(request)) as { proof?: unknown; walletIdentityKey?: unknown };
    const proofRes = await verifyRequestProof(body, AUTH_PROOF_PURPOSE.myShares, auth.user);
    if (proofRes instanceof NextResponse) return proofRes;

    await connectToMongo();

    const investorPubKey = proofRes.identityKey;

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
      {
        $lookup: {
          from: "properties",
          localField: "propertyId",
          foreignField: "_id",
          as: "property",
        },
      },
      {
        $addFields: {
          propertyTitle: { $arrayElemAt: ["$property.title", 0] },
        },
      },
      { $project: { children: 0, property: 0 } },
      { $sort: { createdAt: -1 } },
    ];

    const shares = await sharesCollection.aggregate(pipeline).toArray();
    return NextResponse.json({ shares });
  } catch (e) {
    logger.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
