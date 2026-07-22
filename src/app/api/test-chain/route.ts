import { NextResponse } from "next/server";
import { connectToMongo, sharesCollection } from "../../../lib/mongo";
import { traceShareChain } from "../../../utils/shareChain";
import { readJsonBody, asObjectId } from "../../../utils/validation";
import { handleRouteError } from "../../../utils/apiError";

// Public provenance check. Returns whether `leafTransferTxid` (or the investor's latest share)
// traces back to the property's genesis mint — WITHOUT exposing the per-hop ownership history.
export async function POST(request: Request) {
  try {
    const body = (await readJsonBody(request)) as {
      propertyId?: unknown; leafTransferTxid?: unknown; investorId?: unknown;
    };

    await connectToMongo();

    const propertyId = asObjectId(body.propertyId, "propertyId");
    const investorId = typeof body.investorId === "string" ? body.investorId : undefined;

    let leaf = typeof body.leafTransferTxid === "string" ? body.leafTransferTxid : undefined;
    if (!leaf) {
      if (!investorId) {
        return NextResponse.json({ error: "Provide leafTransferTxid or investorId" }, { status: 400 });
      }
      const lastShare = await sharesCollection
        .find({ propertyId, investorId })
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray();
      if (!lastShare.length) {
        return NextResponse.json({ error: "No shares found for investor on this property" }, { status: 404 });
      }
      leaf = lastShare[0].transferTxid as string;
    }

    const result = await traceShareChain({ propertyId, leafTransferTxid: leaf });
    // Provenance-safe projection: omit `hops` (historical owners/amounts).
    return NextResponse.json({
      valid: result.valid,
      reason: result.reason,
      mintTxid: result.mintTxid,
      startedFrom: result.startedFrom,
      endedAt: result.endedAt,
      length: result.length,
    });
  } catch (e) {
    return handleRouteError(e, "Internal server error");
  }
}
