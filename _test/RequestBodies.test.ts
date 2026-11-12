import { PrivateKey } from '@bsv/sdk';
import {
  parseListingPurchase, parseCancelListing, parseNewListing, parseSharePurchase, parseCreateProperty,
} from '@server/lib/requestBodies';
import { ValidationError } from '@server/lib/validation';

const PK = PrivateKey.fromRandom().toPublicKey().toString();
const PK2 = PrivateKey.fromRandom().toPublicKey().toString();
const ID = '0123456789abcdef01234567';
const TXID = 'ab'.repeat(32);
const OUTPOINT = `${TXID}.0`;
const ACTION = { txid: TXID, tx: [1, 2, 3] };

const rejects = (fn: () => unknown) => expect(fn).toThrow(ValidationError);

describe('parseListingPurchase', () => {
  const ok = { marketItemId: ID, buyerId: PK, paymentNonce: 'n', paymentTX: ACTION };
  test('accepts a well-formed body', () => expect(parseListingPurchase(ok)).toMatchObject({ marketItemId: ID, buyerId: PK }));
  test.each([
    ['non-object body', null],
    ['bad marketItemId', { ...ok, marketItemId: 'x' }],
    ['operator object as id', { ...ok, marketItemId: { $ne: null } }],
    ['buyerId not a pubkey', { ...ok, buyerId: 'buyer' }],
    ['missing nonce', { ...ok, paymentNonce: undefined }],
    ['paymentTX without bytes', { ...ok, paymentTX: { txid: TXID } }],
    ['paymentTX bad txid', { ...ok, paymentTX: { txid: 'zz', tx: [1] } }],
    ['paymentTX non-byte', { ...ok, paymentTX: { txid: TXID, tx: [256] } }],
  ])('rejects %s', (_n, body) => rejects(() => parseListingPurchase(body)));
});

describe('parseCancelListing', () => {
  const ok = { marketItemId: ID, returnTxid: TXID, cancelBeef: 'AAAA', cancelNonce: 'n' };
  test('accepts a well-formed body', () => expect(parseCancelListing(ok)).toEqual(ok));
  // useCancelListing sends toOutpoint(txid, 0); the route normalizes either form.
  test('accepts the outpoint form the client sends', () =>
    expect(parseCancelListing({ ...ok, returnTxid: OUTPOINT }).returnTxid).toBe(OUTPOINT));
  test.each([
    ['bad returnTxid', { ...ok, returnTxid: 'abc' }],
    ['missing beef', { ...ok, cancelBeef: undefined }],
    ['numeric nonce', { ...ok, cancelNonce: 5 }],
  ])('rejects %s', (_n, body) => rejects(() => parseCancelListing(body)));
});

describe('parseNewListing', () => {
  const ok = {
    propertyId: ID, sellerId: PK, amount: 5, parentTxid: OUTPOINT, transferTxid: `${TXID}.1`,
    pricePerShare: 10, listingBeef: 'AAAA', listingNonce: 'n', sellerChild: PK, serverChild: PK2,
  };
  test('accepts a well-formed body', () => expect(parseNewListing(ok)).toEqual(ok));
  test.each([
    ['zero amount', { ...ok, amount: 0 }],
    ['string amount', { ...ok, amount: '5' }],
    ['negative price', { ...ok, pricePerShare: -1 }],
    ['bad parentTxid', { ...ok, parentTxid: TXID }],
    ['bad serverChild', { ...ok, serverChild: 'k' }],
  ])('rejects %s', (_n, body) => rejects(() => parseNewListing(body)));
});

describe('parseSharePurchase', () => {
  const ok = { propertyId: ID, investorId: PK, amount: 10 };
  test('accepts a well-formed body', () => expect(parseSharePurchase(ok)).toEqual(ok));
  test.each([
    ['zero amount', { ...ok, amount: 0 }],
    ['over 100%', { ...ok, amount: 101 }],
    ['bad propertyId', { ...ok, propertyId: '1' }],
  ])('rejects %s', (_n, body) => rejects(() => parseSharePurchase(body)));
});

describe('parseCreateProperty', () => {
  // Mirrors the payload admin.tsx builds.
  const data = {
    title: 't', location: 'l', priceUSD: 100, investors: 0, status: 'open', annualisedReturn: '5%',
    currentValuationUSD: 100, grossYield: '4%', netYield: '3%',
    investmentBreakdown: { purchaseCost: 1, transactionCost: 1, runningCost: 1 },
    whyInvest: [{ title: 'a', text: 'b' }], description: { details: 'd', features: ['Pool'] },
    features: { Bedroom: 2 }, images: ['x.png'], sell: { percentToSell: 80, remainingPercent: 80 },
  };
  const ok = { data, paymentTxAction: ACTION, paymentNonce: 'n', seller: PK };
  test('accepts the admin payload', () => expect(parseCreateProperty(ok).data).toEqual(data));
  test('drops fields outside the whitelist (no mass assignment)', () => {
    const out = parseCreateProperty({ ...ok, data: { ...data, _id: 'x', txids: { tokenTxid: 'evil' }, seller: 'evil' } }).data;
    expect(out).not.toHaveProperty('_id');
    expect(out).not.toHaveProperty('txids');
    expect(out).not.toHaveProperty('seller');
  });
  test.each([
    ['missing data', { ...ok, data: undefined }],
    ['array data', { ...ok, data: [] }],
    ['non-string title', { ...ok, data: { ...data, title: 5 } }],
    ['unknown status', { ...ok, data: { ...data, status: { $ne: 1 } } }],
    ['string price', { ...ok, data: { ...data, priceUSD: '100' } }],
    ['sell over 100%', { ...ok, data: { ...data, sell: { percentToSell: 101 } } }],
    ['bad paymentTxAction', { ...ok, paymentTxAction: {} }],
  ])('rejects %s', (_n, body) => rejects(() => parseCreateProperty(body)));
});
