import type { Request, Response, NextFunction } from 'express';
import { authServer } from '@shared/authProof';
import { consumeNonce } from '../lib/authNonceStore';
import { checkSessionCookie, CLEAR_OPTS } from './requireSession';
import { logger } from '@shared/logger';

/**
 * Two-layer guard for value-moving routes: a valid login session (JWT cookie)
 * AND a valid single-use signed ownership proof (req.body.proof), bound to the
 * same identity. `purpose` scopes the proof to the action.
 *
 * Verifies against protoWallet, not the server wallet: proof verification needs
 * no UTXOs, so it must not touch the wallet queue or the storage service.
 */
export function requireAuthProof(purpose: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const session = await checkSessionCookie(req);
    if (session.userId === null) {
      if (session.clearCookie) res.clearCookie('verified', CLEAR_OPTS);
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const body = req.body as { proof?: unknown; walletIdentityKey?: unknown } | undefined;
    const proof = body?.proof;
    const walletIdentityKey = body?.walletIdentityKey;
    if (!proof || typeof walletIdentityKey !== 'string') {
      res.status(401).json({ error: 'Missing auth proof' });
      return;
    }

    let result;
    try {
      const { default: protoWallet } = await import('../lib/protoWallet');
      result = await authServer.verifyAuthProof(protoWallet, proof as never, purpose, { consumeNonce });
    } catch (e) {
      // Fail closed: respond rather than hang or crash the single process.
      logger.error('[requireAuthProof] unexpected error:', e);
      res.status(500).json({ error: 'Authentication error' });
      return;
    }

    // Identity must match BOTH the body-supplied key and the cookie user.
    if (!result.valid || result.identityKey !== walletIdentityKey || result.identityKey !== session.userId) {
      res.status(401).json({ error: result.error ?? 'Invalid auth proof' });
      return;
    }
    req.userId = session.userId;
    next();
  };
}
