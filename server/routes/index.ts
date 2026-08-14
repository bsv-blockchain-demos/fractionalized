import type { Express } from 'express';
import { tokenizeRouter } from './tokenize';
import { sharePurchaseRouter } from './sharePurchase';
import { listingPurchaseRouter } from './listingPurchase';
import { listingsRouter } from './listings';
import { propertiesRouter } from './properties';
import { sharesRouter } from './shares';
import { authRouter, checkSessionRouter } from './auth';
import { probesRouter } from './probes';

/**
 * Mount every feature router. Populated as routes are ported.
 *
 * One `app.use(...)` line per feature router — append new ones below, never
 * replace an existing line.
 */
export function mountRoutes(app: Express): void {
  app.use('/api/tokenize', tokenizeRouter);
  app.use('/api/share-purchase', sharePurchaseRouter);
  app.use('/api/listing-purchase', listingPurchaseRouter);
  app.use('/api', listingsRouter);
  app.use('/api/properties', propertiesRouter);
  app.use('/api', sharesRouter);
  app.use('/api/auth', authRouter);
  app.use('/api', checkSessionRouter);
  app.use('/api', probesRouter);
  // append further routers here as routes are ported
}
