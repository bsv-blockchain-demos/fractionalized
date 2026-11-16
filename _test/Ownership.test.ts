import request from 'supertest';
import { ObjectId } from 'mongodb';
import { Beef, PrivateKey, ProtoWallet, PublicKey, Transaction, UnlockingScript } from '@bsv/sdk';
import type { Request, Response, NextFunction } from 'express';

// Ownership enforcement on the value-moving routes. The session user comes from a
// test header; Mongo is real. Each test asserts the refusal AND that nothing was written.
const asUser = (req: Request, _res: Response, next: NextFunction) => {
  req.userId = req.header('x-test-user') as string;
  next();
};
jest.mock('@server/middleware/requireSession', () => ({
  ...jest.requireActual('@server/middleware/requireSession'),
  requireSession: asUser,
}));
jest.mock('@server/middleware/requireAuthProof', () => ({ requireAuthProof: () => asUser }));
jest.mock('@server/lib/serverWallet', () => ({ getServerWallet: async () => new ProtoWallet(PrivateKey.fromRandom()) }));
jest.mock('@server/lib/shareChain', () => ({ traceShareChain: async () => ({ valid: true }) }));
jest.mock('@shared/overlay', () => ({ broadcastTX: jest.fn(), getTransactionByTxID: jest.fn() }));

import { buildApp } from '@server/app';
import { OrdinalsP2MS } from '@shared/bsv/ordinalsP2MS';
import { hashFromPubkeys } from '@shared/bsv/hashFromPubkeys';
import { encodeBeef } from '@shared/bsv/beefEncoding';
import { startMongo, stopMongo, clearMongo } from './mongoHarness';

const pk = () => PrivateKey.fromRandom().toPublicKey().toString();
const ALICE = pk();
const MALLORY = pk();
const TOKEN = `${'cd'.repeat(32)}.0`;
const ACTION = { txid: 'ab'.repeat(32), tx: [1] };

let db: Awaited<ReturnType<typeof startMongo>>;
beforeAll(async () => { db = await startMongo(); }, 120000);
afterAll(stopMongo);
beforeEach(() => clearMongo(db));

const post = (path: string, user: string, body: object) =>
  request(buildApp()).post(path).set('x-test-user', user).send(body);

async function seedProperty() {
  const _id = new ObjectId();
  await db.propertiesCollection.insertOne({ _id, seller: ALICE, txids: { tokenTxid: TOKEN, originalMintTxid: TOKEN } } as never);
  return _id;
}

describe('new-listing: the seller must own an unspent share with enough balance', () => {
  // A listing tx that passes the on-chain shape checks, so the request reaches the DB gate.
  async function setup(share: { investorId: string; amount: number }, listAmount: number) {
    const propertyId = await seedProperty();
    const parentTxid = `${'ee'.repeat(32)}.0`;
    await db.sharesCollection.insertOne({
      _id: new ObjectId(), propertyId, parentTxid: `${'aa'.repeat(32)}.0`, transferTxid: parentTxid,
      createdAt: new Date(), ...share,
    });
    const sellerChild = pk();
    const serverChild = pk();
    const lock = new OrdinalsP2MS().lock(
      hashFromPubkeys([PublicKey.fromString(sellerChild), PublicKey.fromString(serverChild)]),
      parentTxid.replace('.', '_'), TOKEN, listAmount, 'transfer');
    const tx = new Transaction(1, [{
      sourceTXID: 'ee'.repeat(32), sourceOutputIndex: 0, sequence: 0xffffffff, unlockingScript: UnlockingScript.fromHex('51'),
    }], [{ lockingScript: lock, satoshis: 1 }], 0);
    const beef = new Beef();
    beef.mergeRawTx(tx.toBinary());
    const body = {
      propertyId: propertyId.toString(), sellerId: ALICE, amount: listAmount, parentTxid,
      transferTxid: `${tx.id('hex')}.0`, pricePerShare: 1, listingBeef: encodeBeef(beef.toBinary()),
      listingNonce: 'n', sellerChild, serverChild,
    };
    return { propertyId, parentTxid, body };
  }
  const listings = () => db.marketItemsCollection.countDocuments();

  test('lists a share the seller owns (positive control)', async () => {
    const { body } = await setup({ investorId: ALICE, amount: 10 }, 5);
    expect((await post('/api/new-listing', ALICE, body)).status).toBe(200);
    expect(await listings()).toBe(1);
  });

  test("refuses to list someone else's share", async () => {
    const { body } = await setup({ investorId: MALLORY, amount: 10 }, 5);
    expect((await post('/api/new-listing', ALICE, body)).status).toBe(403);
    expect(await listings()).toBe(0);
  });

  test('refuses to list more than the share holds', async () => {
    const { body } = await setup({ investorId: ALICE, amount: 10 }, 11);
    expect((await post('/api/new-listing', ALICE, body)).status).toBe(400);
    expect(await listings()).toBe(0);
  });

  test('refuses to list a share that is already spent or listed', async () => {
    const { propertyId, parentTxid, body } = await setup({ investorId: ALICE, amount: 10 }, 5);
    await db.sharesCollection.insertOne({
      _id: new ObjectId(), propertyId, investorId: ALICE, amount: 10,
      parentTxid, transferTxid: `${'ff'.repeat(32)}.0`, createdAt: new Date(),
    });
    expect((await post('/api/new-listing', ALICE, body)).status).toBe(409);
    expect(await listings()).toBe(0);
  });

  test('refuses to list for another seller', async () => {
    const { body } = await setup({ investorId: ALICE, amount: 10 }, 5);
    expect((await post('/api/new-listing', MALLORY, body)).status).toBe(403);
    expect(await listings()).toBe(0);
  });
});

test("cancel-listing refuses someone else's listing", async () => {
  const propertyId = await seedProperty();
  const shareId = new ObjectId();
  await db.sharesCollection.insertOne({
    _id: shareId, propertyId, investorId: ALICE, amount: 10,
    parentTxid: `${'aa'.repeat(32)}.0`, transferTxid: `${'bb'.repeat(32)}.0`, createdAt: new Date(),
  });
  const marketItemId = new ObjectId();
  await db.marketItemsCollection.insertOne({
    _id: marketItemId, propertyId, sellerId: ALICE, shareId, sellAmount: 10, pricePerShare: 1, createdAt: new Date(),
  });
  const res = await post('/api/cancel-listing', MALLORY, {
    marketItemId: marketItemId.toString(), returnTxid: 'cc'.repeat(32), cancelBeef: 'AAAA', cancelNonce: 'n',
  });
  expect(res.status).toBe(403);
  expect(await db.marketItemsCollection.countDocuments({ _id: marketItemId })).toBe(1);
  expect(await db.sharesCollection.countDocuments({ investorId: MALLORY })).toBe(0);

  const reserve = await post('/api/cancel-listing/reserve', MALLORY, { marketItemId: marketItemId.toString() });
  expect(reserve.status).toBe(403);
  expect((await db.marketItemsCollection.findOne({ _id: marketItemId }))?.saleClaimedBy).toBeUndefined();
});

describe('purchases must be made as the session user', () => {
  test('listing-purchase refuses a buyerId that is not the caller', async () => {
    const res = await post('/api/listing-purchase', MALLORY, {
      marketItemId: new ObjectId().toString(), buyerId: ALICE, paymentNonce: 'n', paymentTX: ACTION,
    });
    expect(res.status).toBe(403);
  });

  test('share-purchase refuses an investorId that is not the caller', async () => {
    const res = await post('/api/share-purchase', MALLORY, {
      propertyId: new ObjectId().toString(), investorId: ALICE, amount: 5,
    });
    expect(res.status).toBe(403);
    expect(await db.locksCollection.countDocuments()).toBe(0);
  });

  test('create-property refuses a seller that is not the caller', async () => {
    const data = {
      title: 't', location: 'l', priceUSD: 1, investors: 0, status: 'open', annualisedReturn: '1%',
      currentValuationUSD: 1, grossYield: '1%', netYield: '1%',
      investmentBreakdown: { purchaseCost: 1, transactionCost: 1, runningCost: 1 },
      features: {}, images: [], sell: { percentToSell: 10 },
    };
    const res = await post('/api/tokenize/create-property', MALLORY, {
      data, paymentTxAction: ACTION, paymentNonce: 'n', seller: ALICE,
    });
    expect(res.status).toBe(403);
    expect(await db.propertiesCollection.countDocuments()).toBe(0);
  });
});
