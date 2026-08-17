import { Router, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { connectToMongo, marketItemsCollection, propertiesCollection, sharesCollection, listingBeefsCollection } from '../lib/mongo';
import { toPublicProperty } from '../lib/serializers';
import { AUTH_PROOF_PURPOSE } from '@shared/authProofPurposes';
import { logger } from '@shared/logger';
import { sendRouteError } from '../lib/routeError';
import { requireSession } from '../middleware/requireSession';
import { requireAuthProof } from '../middleware/requireAuthProof';

export const sharesRouter = Router();

/**
 * GET /api/listings — public secondary-market listings (unsold market items).
 *
 * Ported verbatim from src/app/api/listings/route.ts.
 *
 * Guard is session-only, matching the source's requireAuth.
 */
sharesRouter.get('/listings', requireSession, async (req: Request, res: Response) => {
    try {
        const page = Number(req.query.page || 1);
        const limit = Number(req.query.limit || 20);
        const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
        const safePage = Math.max(1, Number(page) || 1);
        const skip = Math.max(0, (safePage - 1) * safeLimit);

        await connectToMongo();

        // Find unsold listings (sold: false OR missing)
        const cursor = marketItemsCollection.aggregate([
            {
                $match: {
                    $or: [
                        { sold: { $exists: false } },
                        { sold: false },
                    ],
                },
            },
            {
                $lookup: {
                    from: propertiesCollection.collectionName,
                    localField: "propertyId",
                    foreignField: "_id",
                    as: "property",
                },
            },
            { $unwind: { path: "$property", preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id: 1,
                    propertyId: 1,
                    sellerId: 1,
                    shareId: 1,
                    sellAmount: 1,
                    pricePerShare: 1,
                    createdAt: 1,
                    name: { $ifNull: ["$property.title", "Unknown Property"] },
                    location: { $ifNull: ["$property.location", "Unknown"] },
                },
            },
            { $sort: { createdAt: -1 } },
            { $skip: skip },
            { $limit: safeLimit },
        ]);

        const items = await cursor.toArray();
        // Normalize ids to strings for the client
        const normalized = items.map((i: any) => ({
            _id: String(i._id),
            propertyId: String(i.propertyId instanceof ObjectId ? i.propertyId : i.propertyId),
            sellerId: String(i.sellerId),
            shareId: String(i.shareId),
            sellAmount: Number(i.sellAmount ?? 0),
            pricePerShare: Number(i.pricePerShare ?? 0),
            name: String(i.name ?? "Unknown Property"),
            location: String(i.location ?? "Unknown"),
          }));

        res.json({ items: normalized, page: safePage, limit: safeLimit });
    } catch (e) {
        logger.error(e);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * POST /api/my-shares — the caller's currently-owned shares (leaf shares with
 * no child referencing them via parentTxid).
 *
 * Ported verbatim from src/app/api/my-shares/route.ts.
 *
 * Step-up guarded: requireSession (cookie) + requireAuthProof (single-use
 * signed ownership proof), scoped to AUTH_PROOF_PURPOSE.myShares. This is one
 * of only three routes in the app using requireAuthProof — it exists so a
 * valid session cannot be used to read a DIFFERENT identity's holdings.
 * requireAuthProof already asserts identityKey === body.walletIdentityKey ===
 * cookie user before calling next(), so req.userId here is exactly the
 * source's proofRes.identityKey (see requireAuthProof.ts:44 and Task 9's
 * report for how that equivalence was confirmed).
 */
sharesRouter.post(
    '/my-shares',
    requireSession,
    requireAuthProof(AUTH_PROOF_PURPOSE.myShares),
    async (req: Request, res: Response) => {
        try {
            await connectToMongo();

            const investorPubKey = req.userId as string;

            // Return only shares currently owned by the user: shares for this investor pubkey
            // where there is no other share with parentTxid equal to this share's transferTxid
            const pipeline = [
                { $match: { investorId: investorPubKey } },
                {
                    $lookup: {
                        from: "shares",
                        localField: "transferTxid",
                        foreignField: "parentTxid",
                        as: "children",
                    },
                },
                { $match: { $expr: { $eq: [{ $size: "$children" }, 0] } } },
                {
                    $lookup: {
                        from: "properties",
                        localField: "propertyId",
                        foreignField: "_id",
                        as: "property",
                    },
                },
                {
                    $addFields: {
                        propertyTitle: { $arrayElemAt: ["$property.title", 0] },
                    },
                },
                { $project: { children: 0, property: 0 } },
                { $sort: { createdAt: -1 } },
            ];

            const shares = await sharesCollection.aggregate(pipeline).toArray();
            res.json({ shares });
        } catch (e) {
            logger.error(e);
            res.status(500).json({ error: "Internal server error" });
        }
    },
);

/**
 * POST /api/my-listings — the caller's own active secondary-market listings,
 * including the multisig outpoint/BEEF needed to build a cancel spend.
 *
 * Ported verbatim from src/app/api/my-listings/route.ts.
 *
 * Step-up guarded exactly like /my-shares above, scoped to
 * AUTH_PROOF_PURPOSE.myListings.
 */
sharesRouter.post(
    '/my-listings',
    requireSession,
    requireAuthProof(AUTH_PROOF_PURPOSE.myListings),
    async (req: Request, res: Response) => {
        try {
            await connectToMongo();

            const userId = req.userId as string;

            const cursor = marketItemsCollection.aggregate([
                { $match: { sellerId: userId, $or: [{ sold: { $exists: false } }, { sold: false }] } },
                {
                    $lookup: {
                        from: propertiesCollection.collectionName,
                        localField: "propertyId",
                        foreignField: "_id",
                        as: "property",
                    },
                },
                { $unwind: { path: "$property", preserveNullAndEmptyArrays: true } },
                // Join the listing's backed-up BEEF (listing_beefs.listingId is the market_item _id as a string).
                { $addFields: { listingIdStr: { $toString: "$_id" } } },
                {
                    $lookup: {
                        from: listingBeefsCollection.collectionName,
                        localField: "listingIdStr",
                        foreignField: "listingId",
                        as: "listingBeefDoc",
                    },
                },
                { $unwind: { path: "$listingBeefDoc", preserveNullAndEmptyArrays: true } },
                {
                    $project: {
                        _id: 1,
                        propertyId: 1,
                        sellerId: 1,
                        shareId: 1,
                        sellAmount: 1,
                        pricePerShare: 1,
                        createdAt: 1,
                        name: { $ifNull: ["$property.title", "Unknown Property"] },
                        location: { $ifNull: ["$property.location", "Unknown"] },
                        tokenTxid: "$property.txids.tokenTxid",
                        // listingNonce used to derive the multisig keys (server's perspective stores it as keyId).
                        keyId: 1,
                        // The multisig outpoint being spent, plus its BEEF (for the client to build the cancel spend).
                        listingOutpoint: "$listingBeefDoc.listingOutpoint",
                        listingBeef: "$listingBeefDoc.beef",
                    },
                },
                { $sort: { createdAt: -1 } },
            ]);

            const items = await cursor.toArray();
            const normalized = items.map((i: any) => ({
                _id: String(i._id),
                propertyId: String(i.propertyId instanceof ObjectId ? i.propertyId : i.propertyId),
                sellerId: String(i.sellerId),
                shareId: String(i.shareId),
                sellAmount: Number(i.sellAmount ?? 0),
                pricePerShare: Number(i.pricePerShare ?? 0),
                name: String(i.name ?? "Unknown Property"),
                location: String(i.location ?? "Unknown"),
                tokenTxid: i.tokenTxid ? String(i.tokenTxid) : undefined,
                // listingNonce (=keyId) so the seller can derive the multisig keys client-side.
                listingNonce: i.keyId ? String(i.keyId) : undefined,
                // The multisig outpoint to spend, and its BEEF (overlay-independent source tx).
                listingOutpoint: i.listingOutpoint ? String(i.listingOutpoint) : undefined,
                listingBeef: i.listingBeef ? String(i.listingBeef) : undefined,
            }));

            res.json({ items: normalized });
        } catch (e) {
            logger.error(e);
            res.status(500).json({ error: "Internal server error" });
        }
    },
);

/**
 * POST /api/my-selling — the caller's own tokenized properties (properties
 * where they are the seller).
 *
 * Ported verbatim from src/app/api/my-selling/route.ts.
 *
 * Step-up guarded exactly like /my-shares above, scoped to
 * AUTH_PROOF_PURPOSE.mySelling. The source's catch block uses
 * handleRouteError, which returns a NextResponse and has no Express
 * equivalent (see server/lib/routeError.ts); sendRouteError mirrors it
 * against `res` directly.
 */
sharesRouter.post(
    '/my-selling',
    requireSession,
    requireAuthProof(AUTH_PROOF_PURPOSE.mySelling),
    async (req: Request, res: Response) => {
        try {
            await connectToMongo();
            const items = await propertiesCollection.find({ seller: req.userId as string }).toArray();
            res.json({ items: items.map((p) => toPublicProperty(p)) });
        } catch (e) {
            sendRouteError(res, e, "Internal server error");
        }
    },
);
