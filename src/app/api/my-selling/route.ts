import { NextResponse } from "next/server";
import { connectToMongo, propertiesCollection } from "../../../lib/mongo";
import { requireAuth } from "../../../utils/apiAuth";
import { readJsonBody } from "../../../utils/validation";
import { handleRouteError } from "../../../utils/apiError";
import { verifyRequestProof } from "../../../utils/apiAuthProof";
import { AUTH_PROOF_PURPOSE } from "../../../lib/authProofPurposes";
import { toPublicProperty } from "../../../lib/serializers";

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = (await readJsonBody(request)) as { proof?: unknown; walletIdentityKey?: unknown };
    const proofRes = await verifyRequestProof(body, AUTH_PROOF_PURPOSE.mySelling, auth.user);
    if (proofRes instanceof NextResponse) return proofRes;

    await connectToMongo();
    const items = await propertiesCollection.find({ seller: proofRes.identityKey }).toArray();
    return NextResponse.json({ items: items.map((p) => toPublicProperty(p)) });
  } catch (e) {
    return handleRouteError(e, "Internal server error");
  }
}
