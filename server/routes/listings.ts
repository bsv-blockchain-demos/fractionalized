import { Router, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { Transaction, PublicKey } from '@bsv/sdk';
import { connectToMongo, propertiesCollection, sharesCollection, marketItemsCollection, locksCollection, listingBeefsCollection } from '../../src/lib/mongo';
import type { Shares, MarketItem, ListingBeef } from '../../src/lib/mongo';
import { traceShareChain } from '../../src/utils/shareChain';
import { OrdinalsP2MS } from '../../src/utils/ordinalsP2MS';
import { hashFromPubkeys } from '../../src/utils/hashFromPubkeys';
import { decodeBeef } from '../../src/utils/beefEncoding';
import { parseOutpoint, toOutpoint } from '../../src/utils/outpoints';
import { getIdentityKey } from '../../src/utils/tokenDerivation';
import { logger } from '../../src/utils/logger';
import { getServerWallet } from '../lib/serverWallet';
import { requireSession } from '../middleware/requireSession';
import { requireAuthProof } from '../middleware/requireAuthProof';
import { AUTH_PROOF_PURPOSE } from '../../src/lib/authProofPurposes';

export const listingsRouter = Router();

/**
 * POST /api/cancel-listing — cancel a secondary-market listing and return the
 * share to the seller's self-custody.
 *
 * Ported verbatim from src/app/api/cancel-listing/route.ts.
 *
 * NOT queued: the only wallet call here is getIdentityKey(wallet) — a pure
 * wallet.getPublicKey({identityKey:true}) derivation. It selects no UTXOs and
 * mutates nothing, so it runs directly against getServerWallet() rather than
 * through getWalletQueue().enqueue(). Routing a trivial key derivation
 * through the queue would make it wait behind a ~5-7s mint/transfer for no
 * benefit — there is no shared mutable state (UTXO set) for the queue to
 * protect here.
 *
 * Guard: requireSession (login) AND requireAuthProof(AUTH_PROOF_PURPOSE.cancelListing)
 * — a single-use signed proof bound to this action. The Next source was session-only;
 * the proof is a deliberate Task 12 defence-in-depth addition, not a port artifact —
 * do not remove it to "restore fidelity" with the source.
 */
listingsRouter.post(
    '/cancel-listing',
    requireSession,
    requireAuthProof(AUTH_PROOF_PURPOSE.cancelListing),
    async (req: Request, res: Response) => {
        const userIdFromToken = req.userId as string;
        const { marketItemId, returnTxid, cancelBeef, cancelNonce } = req.body;

        let lockId: ObjectId | null = null;
        try {
            await connectToMongo();

            if (!marketItemId || !ObjectId.isValid(marketItemId)) {
                res.status(400).json({ error: "Invalid market item id" });
                return;
            }
            if (!returnTxid || !cancelBeef || !cancelNonce) {
                res.status(400).json({ error: "Missing cancel tx/derivation" });
                return;
            }

            const marketItem = await marketItemsCollection.findOne({ _id: new ObjectId(marketItemId) });
            if (!marketItem) {
                res.status(404).json({ error: "Market item not found" });
                return;
            }

            // Identity check: only the listing's seller can cancel it.
            if (marketItem.sellerId !== userIdFromToken) {
                res.status(403).json({ error: "You can't cancel someone else's listing" });
                return;
            }

            const share = await sharesCollection.findOne({ _id: new ObjectId(marketItem.shareId) });
            if (!share) {
                res.status(404).json({ error: "Listing share not found" });
                return;
            }
            const property = await propertiesCollection.findOne({ _id: new ObjectId(marketItem.propertyId) });
            if (!property) {
                res.status(404).json({ error: "Property not found" });
                return;
            }

            // The listing multisig outpoint is the listing share's transferTxid.
            const listingOutpoint = share.transferTxid;
            const { txid: listingTxid, vout: listingVout } = parseOutpoint(listingOutpoint);

            // Validate the client-built cancel tx: it must spend the listing multisig outpoint
            // and produce a 1-sat ordinal output at index 0.
            let cancelTx: Transaction;
            try {
                cancelTx = Transaction.fromBEEF(decodeBeef(cancelBeef));
            } catch {
                res.status(400).json({ error: "Invalid cancel beef" });
                return;
            }

            const spendsListing = cancelTx.inputs.some(
                (i) => (i.sourceTXID || i.sourceTransaction?.id('hex')) === listingTxid && i.sourceOutputIndex === listingVout
            );
            if (!spendsListing) {
                res.status(400).json({ error: "Cancel tx does not spend the listing multisig" });
                return;
            }
            if (cancelTx.outputs[0]?.satoshis !== 1) {
                res.status(400).json({ error: "Cancel tx output 0 must be a 1-sat ordinal" });
                return;
            }

            // Server identity key the reclaimed P2PKH was locked toward (counterparty for the seller's
            // forSelf:true derivation). Derive server-side for trust; matches what share-purchase stores.
            let serverIdentityKey: string;
            const wallet = await getServerWallet();
            serverIdentityKey = await getIdentityKey(wallet);

            // Acquire lock per (property, seller)
            const propertyObjectId = new ObjectId(marketItem.propertyId);
            try {
                const lockRes = await locksCollection.insertOne({
                    _id: new ObjectId(),
                    propertyId: propertyObjectId,
                    investorId: marketItem.sellerId,
                    createdAt: new Date(),
                });
                lockId = lockRes.insertedId;
            } catch (e: any) {
                if (e?.code === 11000) {
                    res.status(409).json({ error: "Another transfer is in progress for this seller and property" });
                    return;
                }
                throw e;
            }

            // Record the reclaimed self-custody holding. Parent is the listing outpoint we spent.
            // Same shape as a purchased/invested holding: keyId=cancelNonce, counterparty=server identity.
            const reclaimedShare: Shares = {
                _id: new ObjectId(),
                propertyId: propertyObjectId,
                investorId: marketItem.sellerId,
                amount: marketItem.sellAmount,
                parentTxid: listingOutpoint,
                transferTxid: toOutpoint(returnTxid as string, 0),
                createdAt: new Date(),
                keyId: cancelNonce,
                counterparty: serverIdentityKey,
            };
            const shareRes = await sharesCollection.insertOne(reclaimedShare);
            if (!shareRes.insertedId) {
                throw new Error("Failed to record reclaimed share");
            }

            // Remove the listing from the active marketplace (listings/my-listings filter sold=false|missing).
            await listingBeefsCollection.deleteOne({ listingId: marketItemId });
            await marketItemsCollection.deleteOne({ _id: new ObjectId(marketItemId) });

            res.status(200).json({
                status: "success",
                received: {
                    outputIndex: 0,
                    keyId: cancelNonce,
                    counterparty: serverIdentityKey,
                },
            });
        } catch (e) {
            logger.error(e);
            res.status(500).json({ error: "Internal server error" });
        } finally {
            try {
                if (lockId) {
                    await locksCollection.deleteOne({ _id: lockId });
                }
            } catch { }
        }
    },
);

/**
 * POST /api/new-listing — record a client-built secondary-market listing.
 *
 * Ported verbatim from src/app/api/new-listing/route.ts.
 *
 * No wallet use of any kind: this route validates a client-built,
 * user-signed listing transaction rather than building or signing one
 * itself. It decodes the BEEF, checks the tx spends the seller's share at
 * parentTxid, and reconstructs the expected multisig locking script to
 * compare against listingTx.outputs[0] — this comparison is the security
 * control that stops a caller from listing a share they don't own, and is
 * ported exactly, including every check and rejection message. There is no
 * getServerWallet() or getWalletQueue() call anywhere in this handler.
 *
 * Guard: requireSession (login) AND requireAuthProof(AUTH_PROOF_PURPOSE.newListing)
 * — a single-use signed proof bound to this action. The Next source was session-only;
 * the proof is a deliberate Task 12 defence-in-depth addition, not a port artifact —
 * do not remove it to "restore fidelity" with the source.
 */
listingsRouter.post(
    '/new-listing',
    requireSession,
    requireAuthProof(AUTH_PROOF_PURPOSE.newListing),
    async (req: Request, res: Response) => {
        const userIdFromToken = req.userId as string;
        const { propertyId, sellerId, amount, parentTxid, transferTxid, pricePerShare, listingBeef, listingNonce, sellerChild, serverChild } = req.body;

        // Identity check: a user can only create listings for themselves
        if (sellerId !== userIdFromToken) {
            res.status(403).json({ error: "You can't create listings for someone else" });
            return;
        }

        let lockId: ObjectId | null = null;
        try {
            await connectToMongo();

            if (!ObjectId.isValid(propertyId)) {
                res.status(400).json({ error: "Invalid ids" });
                return;
            }
            if (typeof amount !== 'number' || amount <= 0) {
                res.status(400).json({ error: "Invalid amount" });
                return;
            }

            const propertyObjectId = new ObjectId(propertyId);

            const property = await propertiesCollection.findOne({ _id: propertyObjectId });
            if (!property) {
                throw new Error("Property not found");
            }
            if (!property?.txids?.tokenTxid || (!property?.txids?.originalMintTxid && !property?.txids?.mintTxid)) {
                throw new Error("Property token/payment UTXOs not initialized");
            }

            // Validate the client-built listing tx and back up its BEEF (overlay-independent buy/cancel).
            if (!listingBeef || !listingNonce || !sellerChild || !serverChild) {
                res.status(400).json({ error: "Missing listing derivation/beef" });
                return;
            }

            let listingTx: Transaction;
            try {
                listingTx = Transaction.fromBEEF(decodeBeef(listingBeef));
            } catch {
                res.status(400).json({ error: "Invalid listing beef" });
                return;
            }

            // The listing tx must spend the share at `parentTxid` (txid.vout).
            const [parentTxidPart, parentVoutPart] = String(parentTxid).split(".");
            const parentVout = Number(parentVoutPart);
            const spendsParent = listingTx.inputs.some(
                (i) => (i.sourceTXID || i.sourceTransaction?.id('hex')) === parentTxidPart && i.sourceOutputIndex === parentVout
            );
            if (!spendsParent) {
                res.status(400).json({ error: "Listing tx does not spend the seller's share" });
                return;
            }

            // Output 0 must byte-match the expected multisig(seller+server) lock — mirror the client's lock args exactly.
            const expectedLock = new OrdinalsP2MS().lock(
                hashFromPubkeys([PublicKey.fromString(sellerChild), PublicKey.fromString(serverChild)]),
                String(parentTxid).replace(".", "_"),
                property.txids.tokenTxid,
                amount,
                "transfer"
            ).toHex();
            const actualLock = listingTx.outputs[0]?.lockingScript?.toHex();
            if (actualLock !== expectedLock) {
                res.status(400).json({ error: "Listing output does not match expected multisig" });
                return;
            }

            // DB-integrity gate (H-3): the seller must actually own the share being listed.
            const parentShare = await sharesCollection.findOne({ propertyId: propertyObjectId, transferTxid: parentTxid });
            if (!parentShare) {
                res.status(400).json({ error: "Parent share not found" });
                return;
            }
            if (parentShare.investorId !== sellerId) {
                res.status(403).json({ error: "You do not own this share" });
                return;
            }
            if (typeof parentShare.amount === "number" && amount > parentShare.amount) {
                res.status(400).json({ error: "Amount exceeds share balance" });
                return;
            }
            // Leaf check: parent must be unspent/unlisted (no child references it as parentTxid).
            const alreadySpent = await sharesCollection.findOne({ propertyId: propertyObjectId, parentTxid: parentTxid });
            if (alreadySpent) {
                res.status(409).json({ error: "Share already spent or listed" });
                return;
            }

            // Acquire lock per (property, seller)
            try {
                const lockRes = await locksCollection.insertOne({
                    _id: new ObjectId(),
                    propertyId: propertyObjectId,
                    investorId: sellerId,
                    createdAt: new Date(),
                });
                lockId = lockRes.insertedId;
            } catch (e: any) {
                if (e?.code === 11000) {
                    res.status(409).json({ error: "Another transfer is in progress for this seller and property" });
                    return;
                }
                throw e;
            }

            const chainResult = await traceShareChain({ propertyId, leafTransferTxid: parentTxid });

            if (!chainResult.valid) {
                res.status(400).json({ error: chainResult.reason });
                return;
            }

            const formattedShare: Shares = {
                _id: new ObjectId(),
                propertyId: propertyObjectId,
                investorId: sellerId,
                amount,
                parentTxid,
                transferTxid,
                createdAt: new Date(),
            };
            const share = await sharesCollection.insertOne(formattedShare);

            // Listing multisig derivation, server's perspective (it spends deriving against the seller).
            const marketItem: MarketItem = {
                _id: new ObjectId(),
                propertyId: propertyObjectId,
                sellerId,
                shareId: share.insertedId,
                sellAmount: amount,
                pricePerShare,
                createdAt: new Date(),
                keyId: listingNonce,
                counterparty: sellerId,
                counterpartyDerivedKey: sellerChild,
                order: 'self-second',
            };
            const listing = await marketItemsCollection.insertOne(marketItem);

            // Back up the listing tx BEEF so buy/cancel don't depend on the overlay.
            const listingBeefDoc: ListingBeef = {
                listingId: listing.insertedId.toString(),
                listingOutpoint: transferTxid,
                beef: listingBeef,
                createdAt: new Date(),
            };
            await listingBeefsCollection.insertOne(listingBeefDoc);

            res.json({ share, listing });
        } catch (e) {
            logger.error(e);
            res.status(500).json({ error: "Internal server error" });
        } finally {
            if (lockId) {
                await locksCollection.deleteOne({ _id: lockId });
            }
        }
    },
);
