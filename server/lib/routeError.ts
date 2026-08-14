import type { Response } from 'express';
import { ValidationError } from '../../src/utils/validation';
import { logger } from '@shared/logger';

/**
 * Express equivalent of src/utils/apiError.ts's handleRouteError. That helper
 * returns a NextResponse, which has no Express analogue, so this mirrors its
 * branching against `res` directly instead: a ValidationError maps to its own
 * `status` (400) and message; anything else is logged and answered with a
 * generic 500 plus the caller-supplied fallback message.
 */
export function sendRouteError(res: Response, e: unknown, fallbackMessage: string): void {
  if (e instanceof ValidationError) {
    res.status(e.status).json({ error: e.message });
    return;
  }
  logger.error(e);
  res.status(500).json({ error: fallbackMessage });
}
