import type { Request, Response, NextFunction } from 'express';
import { jwtVerify } from 'jose';
import { getJwtSecret } from '../config';
import { logger } from '@shared/logger';

const COOKIE = 'verified';
// Must match the attributes the cookie was set with, or the browser won't clear it.
export const CLEAR_OPTS = { httpOnly: true, secure: true, sameSite: 'strict' as const, path: '/' };

type CookieCheck =
  | { userId: string }
  | { userId: null; clearCookie: boolean };

/**
 * Read the `verified` session JWT. Returns the userId, or null plus whether the
 * bad cookie should be cleared: a PRESENT but invalid/expired/malformed token
 * gets cleared so the client isn't stuck re-sending it; a MISSING cookie has
 * nothing to clear.
 */
export async function checkSessionCookie(req: Request): Promise<CookieCheck> {
  const token = req.cookies?.[COOKIE] as string | undefined;
  if (!token) return { userId: null, clearCookie: false };

  try {
    const secret = new TextEncoder().encode(getJwtSecret());
    const { payload } = await jwtVerify(token, secret);
    if (!payload.user || typeof payload.user !== 'string') {
      return { userId: null, clearCookie: true }; // signed but malformed
    }
    return { userId: payload.user };
  } catch (error) {
    logger.error('JWT error', error);
    return { userId: null, clearCookie: true };
  }
}

/** Convenience for callers that only need the id (no cookie-clearing decision). */
export async function getUserIdFromCookie(req: Request): Promise<string | null> {
  return (await checkSessionCookie(req)).userId;
}

/** Express guard: require a valid login session. Sets req.userId or responds 401. */
export async function requireSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const result = await checkSessionCookie(req);
  if (result.userId === null) {
    if (result.clearCookie) res.clearCookie(COOKIE, CLEAR_OPTS);
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  req.userId = result.userId;
  next();
}
