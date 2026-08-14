import type { Request, Response, NextFunction } from 'express';
import { logger } from '@shared/logger';

/**
 * Terminal Express error middleware (4-arg signature). Logs the real error
 * server-side and returns a generic 500 so internal details never leak.
 * Registered LAST in buildApp. Express 5 forwards rejected async-handler
 * promises here automatically — no express-async-errors shim needed.
 *
 * Exception: an error carrying a numeric `status`/`statusCode` in the
 * 400-499 range (e.g. express.json()'s SyntaxError on malformed JSON, or a
 * ValidationError that escaped a route) is answered with that code and the
 * error's own message instead of the generic 500 — otherwise a client-error
 * case would surface as a misleading 500.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  logger.error('[error]', err);
  if (res.headersSent) return; // a throw after res.json must not double-send

  const code = (err as { status?: unknown; statusCode?: unknown })?.status ?? (err as { statusCode?: unknown })?.statusCode;
  if (typeof code === 'number' && code >= 400 && code <= 499) {
    const message = err instanceof Error ? err.message : 'Bad request';
    res.status(code).json({ error: message });
    return;
  }

  res.status(500).json({ error: 'Internal server error' });
}
