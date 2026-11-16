import request from 'supertest';
import { ObjectId } from 'mongodb';
import {
  Beef, LockingScript, MerklePath, PrivateKey, ProtoWallet, PublicKey, Script, Transaction, UnlockingScript,
} from '@bsv/sdk';
import type { Request, Response, NextFunction } from 'express';

// listing-purchase end to end through signing: real server-side keys (ProtoWallet), real Mongo;
// only auth, the wallet's createAction/signAction, chain tracing, source fetch and overlay are faked.
const serverWallet = new ProtoWallet(PrivateKey.fromRandom());
const fakeAction = {
  createAction: jest.fn(),
  signAction: jest.fn(),
};
const asUser = (req: Request, _res: Response, next: NextFunction) => {
  req.userId = req.header('x-test-user') as string;
  next();
};
let ordinalSource: Transaction;
jest.mock('@server/middleware/requireSession', () => ({
  ...jest.requireActual('@server/middleware/requireSession'),
  requireSession: asUser,
}));
jest.mock('@server/middleware/requireAuthProof', () => ({ requireAuthProof: () => asUser }));
jest.mock('@server/lib/serverWallet', () => ({ getServerWallet: async () => serverWallet }));
jest.mock('@server/lib/walletQueue', () => ({
  getWalletQueue: async () => ({ enqueue: (_label: string, fn: (w: unknown) => unknown) => fn(fakeAction) }),
}));
jest.mock('@server/lib/shareChain', () => ({ traceShareChain: async () => ({ valid: true }) }));
jest.mock('@server/lib/fetchTokenSourceTx', () => ({ fetchTokenSourceTx: async () => ordinalSource }));
jest.mock('@shared/overlay', () => ({
  broadcastTX: async () => ({ status: 'success' }),
  getTransactionByTxID: jest.fn(),
}));

import { buildApp } from '@server/app';
import { OrdinalsP2MS } from '@shared/bsv/ordinalsP2MS';
import { PaymentUtxo } from '@shared/bsv/paymentUtxo';
import { hashFromPubkeys } from '@shared/bsv/hashFromPubkeys';
import { deriveMultisigPair } from '@shared/bsv/tokenDerivation';
import { startMongo, stopMongo, clearMongo } from './mongoHarness';

const SELLER = PrivateKey.fromRandom().toPublicKey().toString();
const BUYER = PrivateKey.fromRandom().toPublicKey().toString();
const PAYMENT_NONCE = 'payment-nonce';

let db: Awaited<ReturnType<typeof startMongo>>;
beforeAll(async () => { db = await startMongo(); }, 120000);
afterAll(stopMongo);
beforeEach(async () => {
  await clearMongo(db);
  fakeAction.createAction.mockReset();
  fakeAction.signAction.mockReset();
});

/** Sighash byte of each DER signature pushed by an unlocking script. */
const sighashTypes = (script: UnlockingScript) =>
  script.chunks.filter((c) => c.data && c.data[0] === 0x30 && c.data.length >= 9 && c.data.length <= 73)
    .map((c) => c.data![c.data!.length - 1]);

/** A mined (merkle-pathed) tx with one output, so BEEF/verify can resolve it. */
function minedTx(lockingScript: LockingScript, satoshis: number): Transaction {
  const tx = new Transaction();
  tx.addInput({ sourceTXID: '00'.repeat(32), sourceOutputIndex: 0, unlockingScript: Script.fromASM('OP_TRUE') });
  tx.addOutput({ lockingScript, satoshis });
  tx.merklePath = MerklePath.fromCoinbaseTxidAndHeight(tx.id('hex'), 1);
  return tx;
}

const LISTING_NONCE = 'listing-nonce';

// Listing lock pubkeys and the market-item fields that tell the route how to unlock it.
async function listingKeys(kind: 'derived' | 'legacy') {
  if (kind === 'derived') {
    // As new-listing stores it: [sellerChild, serverChild] at the listing nonce, server self-second.
    const { selfKey: serverChild, counterpartyKey: sellerChild } = await deriveMultisigPair(serverWallet as never, SELLER, LISTING_NONCE);
    return {
      pubkeys: [sellerChild, serverChild],
      fields: { keyId: LISTING_NONCE, counterparty: SELLER, counterpartyDerivedKey: sellerChild, order: 'self-second' as const },
    };
  }
  // Legacy: [server(keyID "0", self), seller], no keyId on the market item.
  const { publicKey: serverLegacy } = await serverWallet.getPublicKey({
    protocolID: [0, 'fractionalized'], keyID: '0', counterparty: 'self', forSelf: true,
  });
  return { pubkeys: [serverLegacy, SELLER], fields: {} };
}

async function seed(kind: 'derived' | 'legacy' = 'derived') {
  const { pubkeys, fields } = await listingKeys(kind);
  const tokenTxid = `${'cd'.repeat(32)}.0`;
  ordinalSource = minedTx(
    new OrdinalsP2MS().lock(hashFromPubkeys(pubkeys.map((k) => PublicKey.fromString(k))),
      tokenTxid.replace('.', '_'), tokenTxid, 10, 'transfer'),
    1,
  );

  // Buyer's payment UTXO as the client locks it: [buyerChild, serverChild].
  const { selfKey: serverChild, counterpartyKey: buyerChild } = await deriveMultisigPair(serverWallet as never, BUYER, PAYMENT_NONCE);
  const paymentTx = minedTx(
    new PaymentUtxo().lock(hashFromPubkeys([PublicKey.fromString(buyerChild), PublicKey.fromString(serverChild)])),
    80,
  );

  const propertyId = new ObjectId();
  await db.propertiesCollection.insertOne({
    _id: propertyId, seller: SELLER,
    txids: { tokenTxid, originalMintTxid: tokenTxid },
  } as never);
  const shareId = new ObjectId();
  await db.sharesCollection.insertOne({
    _id: shareId, propertyId, investorId: SELLER, amount: 10,
    parentTxid: `${'a'.repeat(64)}.0`, transferTxid: `${ordinalSource.id('hex')}.0`, createdAt: new Date(),
  });
  const marketItemId = new ObjectId();
  await db.marketItemsCollection.insertOne({
    _id: marketItemId, propertyId, sellerId: SELLER, shareId, sellAmount: 10, pricePerShare: 1, createdAt: new Date(), ...fields,
  });

  // The client sends its createAction result: { txid, tx: AtomicBEEF bytes }.
  const paymentTX = { txid: paymentTx.id('hex'), tx: paymentTx.toAtomicBEEF() };
  return { marketItemId, paymentTx, paymentTX };
}

test.each(['derived', 'legacy'] as const)('listing-purchase (%s listing) signs both inputs with valid unlocking scripts and records the sale', async (kind) => {
  const { marketItemId, paymentTx, paymentTX } = await seed(kind);

  let signable: Transaction | undefined;
  fakeAction.createAction.mockImplementation(async (args: { inputs: { outpoint: string }[]; outputs: { lockingScript: string; satoshis: number }[] }) => {
    signable = new Transaction();
    for (const i of args.inputs) {
      const [txid, vout] = i.outpoint.split('.');
      signable.addInput({ sourceTXID: txid, sourceOutputIndex: Number(vout), unlockingScript: new UnlockingScript() });
    }
    for (const o of args.outputs) signable.addOutput({ lockingScript: LockingScript.fromHex(o.lockingScript), satoshis: o.satoshis });
    const beef = new Beef();
    beef.mergeRawTx(signable.toBinary());
    return { signableTransaction: { reference: 'ref', tx: beef.toBinary() } };
  });
  fakeAction.signAction.mockImplementation(async () => {
    const beef = new Beef();
    beef.mergeRawTx(signable!.toBinary());
    return { txid: signable!.id('hex'), tx: beef.toBinary() };
  });

  const res = await request(buildApp()).post('/api/listing-purchase').set('x-test-user', BUYER)
    .send({ marketItemId: marketItemId.toString(), buyerId: BUYER, paymentNonce: PAYMENT_NONCE, paymentTX });

  expect(res.status).toBe(200);

  // The scripts handed to signAction must actually unlock the listing and payment outputs.
  const { spends } = fakeAction.signAction.mock.calls[0][0];
  const final = signable!;
  final.inputs[0].sourceTransaction = ordinalSource;
  final.inputs[0].unlockingScript = UnlockingScript.fromHex(spends['0'].unlockingScript);
  final.inputs[1].sourceTransaction = paymentTx;
  final.inputs[1].unlockingScript = UnlockingScript.fromHex(spends['1'].unlockingScript);
  expect(await final.verify('scripts only')).toBe(true);
  // M-3: every signature commits to all inputs and outputs (SIGHASH_ALL | FORKID).
  expect([0, 1].map((i) => sighashTypes(final.inputs[i].unlockingScript!))).toEqual([[0x41], [0x41]]);

  expect((await db.marketItemsCollection.findOne({ _id: marketItemId }))?.sold).toBe(true);
  expect(await db.sharesCollection.countDocuments({ investorId: BUYER })).toBe(1);
});

test('a DB failure after broadcast marks the listing sold instead of letting it reopen', async () => {
  const { marketItemId, paymentTX } = await seed();
  let signable: Transaction | undefined;
  fakeAction.createAction.mockImplementation(async (args: { inputs: { outpoint: string }[]; outputs: { lockingScript: string; satoshis: number }[] }) => {
    signable = new Transaction();
    for (const i of args.inputs) {
      const [txid, vout] = i.outpoint.split('.');
      signable.addInput({ sourceTXID: txid, sourceOutputIndex: Number(vout), unlockingScript: new UnlockingScript() });
    }
    for (const o of args.outputs) signable.addOutput({ lockingScript: LockingScript.fromHex(o.lockingScript), satoshis: o.satoshis });
    const beef = new Beef();
    beef.mergeRawTx(signable.toBinary());
    return { signableTransaction: { reference: 'ref', tx: beef.toBinary() } };
  });
  fakeAction.signAction.mockImplementation(async () => {
    const beef = new Beef();
    beef.mergeRawTx(signable!.toBinary());
    return { txid: signable!.id('hex'), tx: beef.toBinary() };
  });
  const insert = jest.spyOn(db.sharesCollection, 'insertOne').mockRejectedValueOnce(new Error('db down'));

  const res = await request(buildApp()).post('/api/listing-purchase').set('x-test-user', BUYER)
    .send({ marketItemId: marketItemId.toString(), buyerId: BUYER, paymentNonce: PAYMENT_NONCE, paymentTX });
  insert.mockRestore();

  expect(res.status).toBe(500);
  expect(fakeAction.signAction).toHaveBeenCalled(); // it did broadcast
  const item = await db.marketItemsCollection.findOne({ _id: marketItemId });
  expect(item?.sold).toBe(true);
  expect(item?.saleClaimedAt).toBeUndefined();
});
