import { Router, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { connectToMongo, propertiesCollection, propertyDescriptionsCollection, sharesCollection } from '../../src/lib/mongo';
import { toPublicProperty } from '../../src/lib/serializers';
import { buildFacetPipeline } from '../../src/lib/propertiesPipeline';
import { logger } from '@shared/logger';
import { requireSession } from '../middleware/requireSession';

export const propertiesRouter = Router();

/**
 * POST /api/properties — faceted property search taking a JSON body (not a
 * write). Ported verbatim from src/app/api/properties/route.ts's POST export.
 *
 * Guard is session-only, matching the source's requireAuth.
 */
propertiesRouter.post('/', requireSession, async (req: Request, res: Response) => {
  try {
    const body = req.body;

    await connectToMongo();

    const pipeline = buildFacetPipeline(body);
    const [result] = await propertiesCollection.aggregate(pipeline).toArray();
    const rawItems = result?.items || [];
    const items = rawItems.map((it: any) =>
      toPublicProperty(it, { availablePercent: it.availablePercent, totalSold: it.totalSold, investors: it.investors }),
    );
    const total = (result?.total?.[0]?.count as number) || 0;

    res.json({ items, total, page: body.page ?? 1, limit: body.limit ?? 20 });
  } catch (e: any) {
    logger.error('/api/properties error:', e);
    res.status(500).json({ error: 'Failed to fetch properties' });
  }
});

/**
 * GET /api/properties — same faceted search, driven by query params instead
 * of a body. Ported verbatim from src/app/api/properties/route.ts's GET
 * export.
 *
 * Guard is session-only, matching the source's requireAuth.
 */
propertiesRouter.get('/', requireSession, async (req: Request, res: Response) => {
  try {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);
    const sortBy = (req.query.sortBy as string | undefined) || 'price_desc';
    const activeStatus = (req.query.activeStatus as string | undefined) || 'all';
    const filtersParam = req.query.filters as string | undefined;
    let filters: any = {};
    if (filtersParam) {
      try { filters = JSON.parse(filtersParam); } catch {}
    }

    await connectToMongo();

    const pipeline = buildFacetPipeline({ page, limit, sortBy, activeStatus, filters });
    const [result] = await propertiesCollection.aggregate(pipeline).toArray();
    const rawItems = result?.items || [];
    const items = rawItems.map((it: any) =>
      toPublicProperty(it, { availablePercent: it.availablePercent, totalSold: it.totalSold, investors: it.investors }),
    );
    const total = (result?.total?.[0]?.count as number) || 0;

    res.json({ items, total, page, limit });
  } catch (e) {
    logger.error('/api/properties GET error:', e);
    res.status(500).json({ error: 'Failed to fetch properties' });
  }
});

/**
 * GET /api/properties/:id — single property detail, including its
 * description doc and computed available-shares/investor stats.
 *
 * Ported verbatim from src/app/api/properties/[id]/route.ts. The source's
 * `[id]` dynamic segment becomes `req.params.id`, and the guard (which the
 * source runs before its try block) becomes the requireSession middleware,
 * which runs before this handler at all.
 */
propertiesRouter.get('/:id', requireSession, async (req: Request, res: Response) => {
  try {
    await connectToMongo();

    const id = req.params.id as string;
    if (!id || !ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }

    const _id = new ObjectId(id);
    const property = await propertiesCollection.findOne({ _id });
    if (!property) {
      res.status(404).json({ error: 'Property not found' });
      return;
    }

    const descriptions = await propertyDescriptionsCollection.findOne({ propertyId: _id });

    // Calculate available shares and investors count
    let availablePercent: number | null = null;
    let totalSold = 0;
    let investorsCount = 0;
    const percentToSell = property.sell?.percentToSell;

    if (percentToSell != null) {
      const existingShares = await sharesCollection
        .find({ propertyId: _id })
        .toArray();
      totalSold = existingShares.reduce((sum, share) => sum + share.amount, 0);

      // Use stored remainingPercent if available, otherwise calculate it
      availablePercent = property.sell?.remainingPercent ?? (percentToSell - totalSold);

      // Count unique investors
      const uniqueInvestors = new Set(existingShares.map(share => share.investorId));
      investorsCount = uniqueInvestors.size;
    }

    const item = {
      ...toPublicProperty(property, { availablePercent, totalSold, investors: investorsCount }),
      description: descriptions?.description || { details: '', features: [] },
      whyInvest: descriptions?.whyInvest || [],
    };

    res.json({ item });
  } catch (e) {
    logger.error('/api/properties/[id] GET error:', e);
    res.status(500).json({ error: 'Failed to fetch property' });
  }
});
