import { ObjectId } from 'mongodb';
import { marketItemsCollection } from './mongo';
import type { MarketItem } from './mongo';

// A purchase claims its listing before spending it, so a concurrent cancel or second buyer
// is refused by Mongo instead of racing on-chain (M-2). Claims expire so a crashed purchase
// can't freeze a listing.
export const CLAIM_TTL_MS = 10 * 60 * 1000;

const available = () => ({
  sold: { $ne: true },
  $or: [
    { saleClaimedAt: { $exists: false } },
    { saleClaimedAt: { $lt: new Date(Date.now() - CLAIM_TTL_MS) } },
  ],
});

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

/** Atomically removes the listing for a cancel; null if it's sold, claimed, or not the seller's. */
export async function takeListingForCancel(id: ObjectId, sellerId: string): Promise<MarketItem | null> {
  return marketItemsCollection.findOneAndDelete({ _id: id, sellerId, ...available() });
}
