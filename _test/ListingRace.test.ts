import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ObjectId } from 'mongodb';
import { Transaction, LockingScript, UnlockingScript, Beef, PrivateKey } from '@bsv/sdk';
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
import { connectRaw, ensureSchema } from '@server/lib/mongo';
import { claimListingForSale, takeListingForCancel, CLAIM_TTL_MS } from '@server/lib/listingClaim';
import { encodeBeef } from '@shared/bsv/beefEncoding';

const SELLER = PrivateKey.fromRandom().toPublicKey().toString();
const BUYER = PrivateKey.fromRandom().toPublicKey().toString();
const OP_TRUE = () => LockingScript.fromHex('51');

let mongod: MongoMemoryServer;
let db: Awaited<ReturnType<typeof connectRaw>>;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('fraction_test');
  db = await connectRaw();
  await ensureSchema(db.db);
}, 120000);

afterAll(async () => {
  await (globalThis as { _fractionMongoClient?: { close(): Promise<void> } })._fractionMongoClient?.close();
  await mongod?.stop();
});

beforeEach(async () => {
  await Promise.all([
    db.propertiesCollection.deleteMany({}),
    db.sharesCollection.deleteMany({}),
    db.marketItemsCollection.deleteMany({}),
    db.locksCollection.deleteMany({}),
  ]);
});

// Seeds a listing whose output is spent by a well-formed cancel tx. The property has no
// txids, so a purchase that gets past the claim fails before any wallet/chain work.
async function seedListing(state: Record<string, unknown> = {}) {
  const listingTx = new Transaction(1, [], [{ satoshis: 1, lockingScript: OP_TRUE() }], 0);
  const listingOutpoint = `${listingTx.id('hex')}.0`;
  const cancelTx = new Transaction(1, [{
    sourceTXID: listingTx.id('hex'), sourceOutputIndex: 0, sequence: 0xffffffff,
    unlockingScript: UnlockingScript.fromHex('51'),
  }], [{ satoshis: 1, lockingScript: OP_TRUE() }], 0);
  const beef = new Beef();
  beef.mergeRawTx(cancelTx.toBinary());

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
    reclaimedShares: () => db.sharesCollection.countDocuments({ parentTxid: listingOutpoint }),
    marketItem: () => db.marketItemsCollection.findOne({ _id: marketItemId }),
  };
}

const cancel = (body: object) =>
  request(buildApp()).post('/api/cancel-listing').set('x-test-user', SELLER).send(body);
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

  test('cancels an available listing', async () => {
    const l = await seedListing();
    const res = await cancel(l.cancelBody);
    expect(res.status).toBe(200);
    expect(await l.reclaimedShares()).toBe(1);
    expect(await l.marketItem()).toBeNull();
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

test('M-2: concurrent buyers and a cancel — exactly one wins', async () => {
  const l = await seedListing();
  const id = new ObjectId(l.marketItemId);
  const results = await Promise.all([
    ...['b1', 'b2', 'b3', 'b4'].map((b) => claimListingForSale(id, b)),
    takeListingForCancel(id, SELLER).then(Boolean),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
});
