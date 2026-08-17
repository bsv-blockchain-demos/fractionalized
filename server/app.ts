import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import { mountRoutes } from './routes';
import { errorHandler } from './middleware/errorHandler';
import { getAllowedOrigins } from './config';

/**
 * Build the Express app: logging, credentialed CORS, JSON + cookies, routes,
 * and a terminal error handler. API-only — the SPA is deployed separately.
 */
export function buildApp(): Express {
  const app = express();

  app.use((req, res, next) => {
    const start = Date.now();
    // console.log, not logger.debug: logger.debug/info deliberately no-op in
    // production (see shared/logger.ts), but request logging is the primary
    // diagnostic signal for a stalled wallet queue and must emit in every env.
    console.log(`[server] --> ${req.method} ${req.originalUrl}`);
    res.on('finish', () => {
      console.log(`[server] <-- ${req.method} ${req.originalUrl} ${res.statusCode} (${Date.now() - start}ms)`);
    });
    next();
  });

  // Credentialed CORS: echo the request Origin only if it's allowlisted.
  // Read the allowlist per-request so tests can vary it without rebuilding.
  app.use((req, res, next) => {
    const allowed = getAllowedOrigins();
    const origin = req.headers.origin;
    if (origin && allowed.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.header('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });

  // 10mb: create-property carries a base64 PDF + images; the 100kb default would 413.
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());

  mountRoutes(app);

  app.use(errorHandler);

  return app;
}
