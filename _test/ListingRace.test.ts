import request from 'supertest';
import { ObjectId } from 'mongodb';
import { Transaction, LockingScript, UnlockingScript, Beef, PrivateKey, MerklePath } from '@bsv/sdk';
import type { Request, Response, NextFunction } from 'express';

// M-2: sale vs cancel on the same listing. Auth and wallet are stubbed; Mongo is real,
// because the fix rests on Mongo's single-document atomicity.
const asUser = (req: Request, _res: Response, next: NextFunction) => {
  req.userId = req.header('x-test-user') as string;
  next();
};
jest.mock('@server/middleware/requireSession', () => ({
  ...jest.requireActual('@server/middleware/requireSession'),
  requireSession: asUser,
}));
jest.mock('@server/middleware/requireAuthProof', () => ({ requireAuthProof: () => asUser }));
jest.mock('@server/lib/serverWallet', () => ({ getServerWallet: async () => ({}) }));
jest.mock('@shared/bsv/tokenDerivation', () => ({
  ...jest.requireActual('@shared/bsv/tokenDerivation'),
  getIdentityKey: async () => 'server-identity',
}));

import { buildApp } from '@server/app';
import { startMongo, stopMongo, clearMongo } from './mongoHarness';
import { claimListingForSale, takeListingForCancel, reserveListingForCancel, cancelReservation, CLAIM_TTL_MS } from '@server/lib/listingClaim';
import { encodeBeef } from '@shared/bsv/beefEncoding';

const SELLER = PrivateKey.fromRandom().toPublicKey().toString();
const BUYER = PrivateKey.fromRandom().toPublicKey().toString();
const OP_TRUE = () => LockingScript.fromHex('51');

let db: Awaited<ReturnType<typeof startMongo>>;
beforeAll(async () => { db = await startMongo(); }, 120000);
afterAll(stopMongo);
beforeEach(() => clearMongo(db));

// Seeds a listing whose output is spent by a well-formed cancel tx. The property has no
// txids, so a purchase that gets past the claim fails before any wallet/chain work.
async function seedListing(state: Record<string, unknown> = {}, cancelUnlockHex = '51') {
  // Mined listing tx, carried in the cancel BEEF the way the wallet's signAction returns it.
  const listingTx = new Transaction(1, [{
    sourceTXID: '00'.repeat(32), sourceOutputIndex: 0, sequence: 0xffffffff, unlockingScript: UnlockingScript.fromHex('51'),
  }], [{ satoshis: 1, lockingScript: LockingScript.fromHex('5187') }], 0); // OP_1 OP_EQUAL
  listingTx.merklePath = MerklePath.fromCoinbaseTxidAndHeight(listingTx.id('hex'), 1);
  const listingOutpoint = `${listingTx.id('hex')}.0`;
  const cancelTx = new Transaction(1, [{
    sourceTransaction: listingTx, sourceOutputIndex: 0, sequence: 0xffffffff,
    unlockingScript: UnlockingScript.fromHex(cancelUnlockHex),
  }], [{ satoshis: 1, lockingScript: OP_TRUE() }], 0);
  const beef = Beef.fromBinary(cancelTx.toBEEF());

  const propertyId = new ObjectId();
  await db.propertiesCollection.insertOne({ _id: propertyId, seller: SELLER, txids: {} } as never);
  const shareId = new ObjectId();
  await db.sharesCollection.insertOne({
    _id: shareId, propertyId, investorId: SELLER, amount: 10,
    parentTxid: `${'a'.repeat(64)}.0`, transferTxid: listingOutpoint, createdAt: new Date(),
  });
  const marketItemId = new ObjectId();
  await db.marketItemsCollection.insertOne({
    _id: marketItemId, propertyId, sellerId: SELLER, shareId,
    sellAmount: 10, pricePerShare: 1, createdAt: new Date(), ...state,
  });

  return {
    marketItemId: marketItemId.toString(),
    cancelBody: {
      marketItemId: marketItemId.toString(),
      returnTxid: cancelTx.id('hex'),
      cancelBeef: encodeBeef(beef.toBinary()),
      cancelNonce: 'nonce',
    },
    cancelTxid: cancelTx.id('hex'),
    reclaimedShares: () => db.sharesCollection.countDocuments({ parentTxid: listingOutpoint }),
    reclaimedShare: () => db.sharesCollection.findOne({ parentTxid: listingOutpoint }),
    marketItem: () => db.marketItemsCollection.findOne({ _id: marketItemId }),
  };
}

const cancel = (body: object) =>
  request(buildApp()).post('/api/cancel-listing').set('x-test-user', SELLER).send(body);
const reserve = (marketItemId: string, user = SELLER) =>
  request(buildApp()).post('/api/cancel-listing/reserve').set('x-test-user', user).send({ marketItemId });
const purchase = (marketItemId: string, buyer = BUYER) =>
  request(buildApp()).post('/api/listing-purchase').set('x-test-user', buyer)
    .send({ marketItemId, buyerId: buyer, paymentNonce: 'n', paymentTX: { txid: 'ab'.repeat(32), tx: [1] } });

describe('M-2: cancel-listing', () => {
  test('rejects cancelling a sold listing and records no reclaimed share', async () => {
    const l = await seedListing({ sold: true });
    const res = await cancel(l.cancelBody);
    expect(res.status).toBe(409);
    expect(await l.reclaimedShares()).toBe(0);
    expect(await l.marketItem()).not.toBeNull();
  });

  test('rejects cancelling while a purchase holds the claim', async () => {
    const l = await seedListing({ saleClaimedAt: new Date(), saleClaimedBy: 'someone' });
    const res = await cancel(l.cancelBody);
    expect(res.status).toBe(409);
    expect(await l.reclaimedShares()).toBe(0);
    expect(await l.marketItem()).not.toBeNull();
  });

  test("rejects a cancel tx whose spend doesn't verify", async () => {
    const l = await seedListing({}, '52'); // pushes 2 against an OP_1 OP_EQUAL lock
    const res = await cancel(l.cancelBody);
    expect(res.status).toBe(400);
    expect(await l.reclaimedShares()).toBe(0);
    expect(await l.marketItem()).not.toBeNull();
  });

  test('cancels an available listing', async () => {
    const l = await seedListing();
    const res = await cancel(l.cancelBody);
    expect(res.status).toBe(200);
    expect(await l.reclaimedShares()).toBe(1);
    expect(await l.marketItem()).toBeNull();
  });

  test('records the reclaimed outpoint from the verified cancel tx', async () => {
    const l = await seedListing();
    expect((await cancel({ ...l.cancelBody, returnTxid: `${l.cancelTxid}.0` })).status).toBe(200);
    expect((await l.reclaimedShare())?.transferTxid).toBe(`${l.cancelTxid}.0`);
  });

  test('rejects a returnTxid that is not the cancel tx', async () => {
    const l = await seedListing();
    const res = await cancel({ ...l.cancelBody, returnTxid: 'ab'.repeat(32) });
    expect(res.status).toBe(400);
    expect(await l.reclaimedShares()).toBe(0);
    expect(await l.marketItem()).not.toBeNull();
  });
});

// The seller broadcasts the cancel before POSTing it, so the claim has to be taken BEFORE the
// broadcast: reserve -> sign + broadcast -> cancel. Otherwise a purchase holding the claim makes
// the cancel 409 after it is already on chain, and releases the claim onto a spent outpoint.
describe('M-2: cancel reservation', () => {
  test('a reservation blocks a purchase', async () => {
    const l = await seedListing();
    expect((await reserve(l.marketItemId)).status).toBe(200);
    expect((await purchase(l.marketItemId)).status).toBe(409);
  });

  test('cannot reserve a listing a purchase holds', async () => {
    const l = await seedListing({ saleClaimedAt: new Date(), saleClaimedBy: 'other-buyer' });
    expect((await reserve(l.marketItemId)).status).toBe(409);
  });

  test('cannot reserve a sold listing', async () => {
    const l = await seedListing({ sold: true });
    expect((await reserve(l.marketItemId)).status).toBe(409);
  });

  test('the seller can cancel while holding the reservation', async () => {
    const l = await seedListing({ saleClaimedAt: new Date(), saleClaimedBy: cancelReservation(SELLER) });
    expect((await cancel(l.cancelBody)).status).toBe(200);
    expect(await l.reclaimedShares()).toBe(1);
    expect(await l.marketItem()).toBeNull();
  });

  test('an expired reservation still lets its seller confirm an already-broadcast cancel', async () => {
    const l = await seedListing({
      saleClaimedAt: new Date(Date.now() - CLAIM_TTL_MS - 1000), saleClaimedBy: cancelReservation(SELLER),
    });
    expect((await cancel(l.cancelBody)).status).toBe(200);
  });
});

describe('M-2: listing-purchase', () => {
  test('rejects buying a sold listing', async () => {
    const l = await seedListing({ sold: true });
    const res = await purchase(l.marketItemId);
    expect(res.status).toBe(409);
  });

  test('rejects buying a listing another buyer has claimed', async () => {
    const l = await seedListing({ saleClaimedAt: new Date(), saleClaimedBy: 'other-buyer' });
    const res = await purchase(l.marketItemId);
    expect(res.status).toBe(409);
  });

  test('releases its claim when it fails before broadcasting', async () => {
    const l = await seedListing();
    const res = await purchase(l.marketItemId);
    expect(res.status).toBe(500); // property has no txids
    const item = await l.marketItem();
    expect(item?.saleClaimedAt).toBeUndefined();
    expect(item?.sold).toBeUndefined();
  });

  test('a stale claim from a crashed purchase does not block the listing', async () => {
    const l = await seedListing({
      saleClaimedAt: new Date(Date.now() - CLAIM_TTL_MS - 1000), saleClaimedBy: 'crashed-buyer',
    });
    const res = await purchase(l.marketItemId);
    expect(res.status).toBe(500); // got past the claim, failed on the property
  });
});

test.each([
  ['a cancel reservation', (id: ObjectId) => reserveListingForCancel(id, SELLER)],
  ['a direct cancel', (id: ObjectId) => takeListingForCancel(id, SELLER).then(Boolean)],
])('M-2: concurrent buyers and %s — exactly one wins', async (_name, seller) => {
  const l = await seedListing();
  const id = new ObjectId(l.marketItemId);
  const results = await Promise.all([
    ...['b1', 'b2', 'b3', 'b4'].map((b) => claimListingForSale(id, b)),
    seller(id),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
});
