import { Router, type Request, type Response } from 'express';
import { connectToMongo, sharesCollection } from '../lib/mongo';
import { traceShareChain } from '../lib/shareChain';
import { asObjectId } from '../lib/validation';
import { checkWalletBalance } from '../lib/walletBalance';
import { getWalletQueue } from '../lib/walletQueue';
import { getServerWallet } from '../lib/serverWallet';
import { getMinBalance } from '../config';
import { sendRouteError } from '../lib/routeError';

export const probesRouter = Router();

/**
 * GET /api/health → { status: 'ok' }.
 *
 * Ported verbatim from src/app/health/route.ts. NOTE: Next served this at
 * `/health` (not under `/api`); Express serves it at `/api/health`, in line
 * with the rest of the API. Real change to the probe URL — call it out to
 * whoever owns deploy/monitoring config.
 */
probesRouter.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

/**
 * GET /api/ready — combined readiness check (wallet + db), fails closed on
 * any error.
 *
 * Ported verbatim from src/app/ready/route.ts (also moves from `/ready` to
 * `/api/ready` — same URL-shape note as /health above), with two additions:
 *  - queueDepth in the success body, from the memoized wallet queue: the
 *    observability hook for a stalled queue (a depth that never drops means a
 *    wallet op is hung and the process needs a restart).
 *  - checkWalletBalance is called with the memoized server wallet
 *    (getServerWallet()) instead of building a fresh one per probe.
 *
 * Deliberately NOT queued: a read-only probe must not wait behind a ~5-7s
 * mint, or it would time out during normal operation. Never call
 * queue.enqueue(...) here — only getServerWallet()/queue.depth().
 */
probesRouter.get('/ready', async (_req: Request, res: Response) => {
  try {
    const { db } = await connectToMongo();
    const balance = await checkWalletBalance(await getServerWallet());
    if (balance < getMinBalance()) throw new Error('Insufficient wallet balance');
    await db.command({ ping: 1 });
    const queue = await getWalletQueue();
    res.json({ status: 'ready', queueDepth: queue.depth() });
  } catch (err) {
    res.status(503).json({ status: 'not ready', error: (err as Error).message });
  }
});

/**
 * POST /api/test-chain — public provenance check. Returns whether
 * `leafTransferTxid` (or the investor's latest share) traces back to the
 * property's genesis mint — WITHOUT exposing the per-hop ownership history.
 *
 * Ported verbatim from src/app/api/test-chain/route.ts. Deliberately
 * unauthenticated (no requireSession) — this is a product feature, a public
 * provenance check, not a diagnostic; the source omits `hops` from the
 * response for the same reason, and this port preserves that projection
 * exactly.
 */
probesRouter.post('/test-chain', async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      propertyId?: unknown; leafTransferTxid?: unknown; investorId?: unknown;
    };

    await connectToMongo();

    const propertyId = asObjectId(body.propertyId, "propertyId");
    const investorId = typeof body.investorId === "string" ? body.investorId : undefined;

    let leaf = typeof body.leafTransferTxid === "string" ? body.leafTransferTxid : undefined;
    if (!leaf) {
      if (!investorId) {
        res.status(400).json({ error: "Provide leafTransferTxid or investorId" });
        return;
      }
      const lastShare = await sharesCollection
        .find({ propertyId, investorId })
        .sort({ createdAt: -1 })
        .limit(1)
        .toArray();
      if (!lastShare.length) {
        res.status(404).json({ error: "No shares found for investor on this property" });
        return;
      }
      leaf = lastShare[0].transferTxid as string;
    }

    const result = await traceShareChain({ propertyId, leafTransferTxid: leaf });
    // Provenance-safe projection: omit `hops` (historical owners/amounts).
    res.json({
      valid: result.valid,
      reason: result.reason,
      mintTxid: result.mintTxid,
      startedFrom: result.startedFrom,
      endedAt: result.endedAt,
      length: result.length,
    });
  } catch (e) {
    sendRouteError(res, e, "Internal server error");
  }
});
