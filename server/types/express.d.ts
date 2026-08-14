// Augment Express's Request with the authenticated user id set by auth middleware.
import 'express';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export {};
