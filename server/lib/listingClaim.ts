import { ObjectId } from 'mongodb';
import { marketItemsCollection } from './mongo';
import type { MarketItem } from './mongo';

// Whoever spends a listing claims it BEFORE broadcasting, so a concurrent cancel or second buyer
// is refused by Mongo instead of racing on-chain (M-2). The server-built purchase claims inside
// its route; the seller broadcasts the cancel client-side, so it reserves first via
// /cancel-listing/reserve. Claims expire so a crashed spender can't freeze a listing.
export const CLAIM_TTL_MS = 10 * 60 * 1000;

const unclaimed = () => [
  { saleClaimedAt: { $exists: false } },
  { saleClaimedAt: { $lt: new Date(Date.now() - CLAIM_TTL_MS) } },
];
const available = () => ({ sold: { $ne: true }, $or: unclaimed() });

/** Claim holder value for a seller's cancel reservation. */
export const cancelReservation = (sellerId: string) => `cancel:${sellerId}`;

export async function claimListingForSale(id: ObjectId, buyerId: string): Promise<boolean> {
  const res = await marketItemsCollection.updateOne(
    { _id: id, ...available() },
    { $set: { saleClaimedAt: new Date(), saleClaimedBy: buyerId } },
  );
  return res.modifiedCount === 1;
}

export async function releaseListingClaim(id: ObjectId, buyerId: string): Promise<void> {
  await marketItemsCollection.updateOne(
    { _id: id, saleClaimedBy: buyerId },
    { $unset: { saleClaimedAt: '', saleClaimedBy: '' } },
  );
}

/** The seller claims their listing before signing and broadcasting a cancel. */
export async function reserveListingForCancel(id: ObjectId, sellerId: string): Promise<boolean> {
  const res = await marketItemsCollection.updateOne(
    { _id: id, sellerId, ...available() },
    { $set: { saleClaimedAt: new Date(), saleClaimedBy: cancelReservation(sellerId) } },
  );
  return res.modifiedCount === 1;
}

/**
 * Atomically removes the listing for a cancel; null if it's sold, claimed by a purchase, or not
 * the seller's. The seller's own reservation counts even after it expires: the cancel it guarded
 * is already on chain by the time it is confirmed here.
 */
export async function takeListingForCancel(id: ObjectId, sellerId: string): Promise<MarketItem | null> {
  return marketItemsCollection.findOneAndDelete({
    _id: id, sellerId, sold: { $ne: true },
    $or: [...unclaimed(), { saleClaimedBy: cancelReservation(sellerId) }],
  });
}
