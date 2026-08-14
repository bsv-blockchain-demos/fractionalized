import { Router, type Request, type Response } from 'express';
import { SignJWT } from 'jose';
import { createSecretKey } from 'crypto';
import { authServer } from '../../src/lib/authProof';
import { consumeNonce } from '../../src/lib/authNonceStore';
import { getJwtSecret } from '../config';
import { checkSessionCookie, CLEAR_OPTS } from '../middleware/requireSession';
import { logger } from '../../src/utils/logger';

export const authRouter = Router();

/**
 * POST /api/auth/login — verify a signed, single-use 'login'-purpose auth
 * proof and mint the session JWT cookie.
 *
 * Ported verbatim from src/app/api/auth/login/route.ts. No requireSession or
 * requireAuthProof guard: this route IS how a caller obtains a session, so it
 * verifies the proof inline against protoWallet (no UTXOs involved, no
 * server-wallet/queue touch) rather than via the requireAuthProof middleware,
 * which assumes an existing session cookie.
 *
 * The purpose string 'login' is a literal, not a member of AUTH_PROOF_PURPOSE
 * (that enum is for the step-up-guarded my-shares/my-listings/my-selling
 * routes) — matches the source exactly.
 *
 * protoWallet is lazy-imported (as requireAuthProof.ts does) rather than
 * imported at module top: it throws at import time if SERVER_PRIVATE_KEY
 * isn't set, and this module is also loaded by check-session's test harness,
 * which never touches SERVER_PRIVATE_KEY (see _test/ApiAuthProof.test.ts's
 * comment on the same hazard).
 */
authRouter.post('/login', async (req: Request, res: Response) => {
    try {
        const body = req.body;
        if (body.request !== "login") {
            res.status(400).json({ message: 'Invalid request' });
            return;
        }

        const { userPubKey, proof, walletIdentityKey } = body;

        if (!proof || !walletIdentityKey) {
            res.status(400).json({ message: 'Missing proof or walletIdentityKey' });
            return;
        }

        // Signed-proof check — expiry-bound, single-use proof of key ownership
        const { default: protoWallet } = await import('../../src/lib/protoWallet');
        const proofResult = await authServer.verifyAuthProof(protoWallet, proof, 'login', { consumeNonce });
        if (!proofResult.valid || proofResult.identityKey !== walletIdentityKey) {
            res.status(401).json({ message: proofResult.error ?? 'Proof identity mismatch' });
            return;
        }

        // Session id = the proof-validated identity key (what type-42 derivation uses).
        const jwt = new SignJWT({
            user: walletIdentityKey,
        });
        jwt.setProtectedHeader({ alg: "HS256" });
        jwt.setExpirationTime("1d");

        const secret = createSecretKey(Buffer.from(getJwtSecret(), "utf-8"));
        const token = await jwt.sign(secret);

        // Cookie attributes must stay identical to the source route (:39-45) —
        // sameSite: 'strict' is the app's sole CSRF defence on value-moving routes.
        // Reuses CLEAR_OPTS (httpOnly/secure/sameSite/path) rather than
        // re-literalling those four attributes here: it's the same shape the
        // cookie must be cleared with later, and a second copy is how the two
        // sides drift apart (see logout below).
        res.cookie("verified", token, {
            ...CLEAR_OPTS,
            expires: new Date(Date.now() + 1440 * 60 * 1000), // 1 day
        });

        // Return success response (user data)
        res.status(200).json({ user: userPubKey });
    } catch (error) {
        logger.error('login failed', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/auth/logout — clear the session cookie.
 *
 * Ported verbatim from src/app/api/auth/logout/route.ts, with ONE deliberate
 * change: the source's response.cookies.delete("verified") emits a
 * Set-Cookie with no attributes, which a browser will not honour unless it
 * matches the attributes the cookie was set with. res.clearCookie(...,
 * CLEAR_OPTS) reuses requireSession's single definition of those attributes
 * (imported, not redefined) so the clear actually works and the two copies
 * cannot drift apart.
 *
 * No requireSession guard: logout must succeed even without a valid session
 * (e.g. an already-expired cookie) — a guard here would 401 instead of
 * clearing the stale cookie.
 */
authRouter.post('/logout', async (_req: Request, res: Response) => {
    try {
        // Delete the auth cookie (same name as used in requireSession)
        res.clearCookie("verified", CLEAR_OPTS);

        res.status(200).json({ message: "Logged out successfully" });
    } catch (error) {
        logger.error("Logout error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

export const checkSessionRouter = Router();

/**
 * GET /api/check-session → { authenticated }.
 *
 * NEW — does not exist in Next. Next's middleware.ts read the httpOnly
 * `verified` cookie directly server-side to gate page navigation; an SPA
 * cannot read an httpOnly cookie from JS, so the client route guard calls
 * this endpoint instead.
 *
 * Always 200, even with no/expired/invalid cookie — never 401. apiFetch
 * treats any 401 as "session expired" and hard-navigates to /login; since the
 * guard calls this endpoint from the login flow itself, a 401 here would
 * cause a redirect loop.
 */
checkSessionRouter.get('/check-session', async (req: Request, res: Response) => {
    const session = await checkSessionCookie(req);
    res.json({ authenticated: session.userId !== null });
});
