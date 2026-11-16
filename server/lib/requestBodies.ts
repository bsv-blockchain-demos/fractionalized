import { ObjectId } from 'mongodb';
import { ValidationError, asString, asEnum } from './validation';
import { outpointPattern } from './validators';
import { PROPERTY_STATUSES } from './propertiesPipeline';
import type { Properties } from './mongo';

// Per-route request-body parsers. Each throws ValidationError (-> 400 via errorHandler)
// so handlers only ever see typed, shape-checked input.

const PUBKEY = /^0[23][0-9a-fA-F]{64}$/;
const TXID = /^[0-9a-fA-F]{64}$/;
const OUTPOINT = new RegExp(outpointPattern);
// The reclaim is always output 0 of the cancel tx; the client sends `${txid}.0`.
const CANCEL_RETURN = /^[0-9a-fA-F]{64}(\.0)?$/;
const MAX_SHORT = 256; // nonces, ids

type Obj = Record<string, unknown>;

function asObject(v: unknown, field: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new ValidationError(`${field} must be an object`);
  return v as Obj;
}
function asMatch(v: unknown, field: string, re: RegExp): string {
  if (typeof v !== 'string' || !re.test(v)) throw new ValidationError(`${field} is malformed`);
  return v;
}
function asId(v: unknown, field: string): string {
  if (typeof v !== 'string' || !ObjectId.isValid(v)) throw new ValidationError(`${field} must be a valid id`);
  return v;
}
function asPositive(v: unknown, field: string, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > max) throw new ValidationError(`${field} is out of range`);
  return v;
}
const short = (v: unknown, field: string) => asString(v, field, { maxLength: MAX_SHORT });

/** A wallet createAction result as sent by the client: { txid, tx: AtomicBEEF bytes }. */
export interface ActionResult { txid: string; tx: number[] }
function asActionResult(v: unknown, field: string): ActionResult {
  const o = asObject(v, field);
  const txid = asMatch(o.txid, `${field}.txid`, TXID);
  if (!Array.isArray(o.tx) || o.tx.length === 0 || !o.tx.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
    throw new ValidationError(`${field}.tx must be a byte array`);
  }
  return { txid, tx: o.tx as number[] };
}

export function parseListingPurchase(body: unknown) {
  const b = asObject(body, 'body');
  return {
    marketItemId: asId(b.marketItemId, 'marketItemId'),
    buyerId: asMatch(b.buyerId, 'buyerId', PUBKEY),
    paymentNonce: short(b.paymentNonce, 'paymentNonce'),
    paymentTX: asActionResult(b.paymentTX, 'paymentTX'),
  };
}

export function parseCancelListing(body: unknown) {
  const b = asObject(body, 'body');
  return {
    marketItemId: asId(b.marketItemId, 'marketItemId'),
    returnTxid: asMatch(b.returnTxid, 'returnTxid', CANCEL_RETURN),
    cancelBeef: asString(b.cancelBeef, 'cancelBeef'),
    cancelNonce: short(b.cancelNonce, 'cancelNonce'),
  };
}

export function parseCancelReserve(body: unknown) {
  const b = asObject(body, 'body');
  return { marketItemId: asId(b.marketItemId, 'marketItemId') };
}

export function parseNewListing(body: unknown) {
  const b = asObject(body, 'body');
  if (typeof b.pricePerShare !== 'number' || !Number.isFinite(b.pricePerShare) || b.pricePerShare < 0) {
    throw new ValidationError('pricePerShare is out of range');
  }
  return {
    propertyId: asId(b.propertyId, 'propertyId'),
    sellerId: asMatch(b.sellerId, 'sellerId', PUBKEY),
    amount: asPositive(b.amount, 'amount'),
    parentTxid: asMatch(b.parentTxid, 'parentTxid', OUTPOINT),
    transferTxid: asMatch(b.transferTxid, 'transferTxid', OUTPOINT),
    pricePerShare: b.pricePerShare,
    listingBeef: asString(b.listingBeef, 'listingBeef'),
    listingNonce: short(b.listingNonce, 'listingNonce'),
    sellerChild: asMatch(b.sellerChild, 'sellerChild', PUBKEY),
    serverChild: asMatch(b.serverChild, 'serverChild', PUBKEY),
  };
}

export function parseSharePurchase(body: unknown) {
  const b = asObject(body, 'body');
  return {
    propertyId: asId(b.propertyId, 'propertyId'),
    investorId: asMatch(b.investorId, 'investorId', PUBKEY),
    amount: asPositive(b.amount, 'amount', 100),
  };
}

/**
 * Whitelist of the client-settable property fields (admin.tsx payload). Anything else the
 * client sends is dropped, so it can't set _id/txids/derivations. Length/range limits stay
 * in the route (they must match validators.ts).
 */
export type CreatePropertyData =
  Omit<Properties, '_id' | 'txids' | 'currentDerivation' | 'paymentDerivation' | 'seller'> & {
    description?: { details: string; features: string[] };
    whyInvest?: { title: string; text: string }[];
  };

function asNonNegative(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new ValidationError(`${field} must be a non-negative number`);
  return v;
}
function asStringArray(v: unknown, field: string): string[] {
  if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) throw new ValidationError(`${field} must be a string array`);
  return v;
}

function parsePropertyData(v: unknown): CreatePropertyData {
  const d = asObject(v, 'data');
  const ib = asObject(d.investmentBreakdown, 'data.investmentBreakdown');
  const sell = asObject(d.sell, 'data.sell');
  const features = asObject(d.features ?? {}, 'data.features');
  for (const [k, n] of Object.entries(features)) asNonNegative(n, `data.features.${k}`);

  const out: CreatePropertyData = {
    title: asString(d.title, 'data.title'),
    location: asString(d.location, 'data.location'),
    priceUSD: asNonNegative(d.priceUSD, 'data.priceUSD'),
    investors: asNonNegative(d.investors, 'data.investors'),
    status: asEnum(d.status, 'data.status', PROPERTY_STATUSES),
    annualisedReturn: asString(d.annualisedReturn, 'data.annualisedReturn'),
    currentValuationUSD: asNonNegative(d.currentValuationUSD, 'data.currentValuationUSD'),
    grossYield: asString(d.grossYield, 'data.grossYield'),
    netYield: asString(d.netYield, 'data.netYield'),
    investmentBreakdown: {
      purchaseCost: asNonNegative(ib.purchaseCost, 'data.investmentBreakdown.purchaseCost'),
      transactionCost: asNonNegative(ib.transactionCost, 'data.investmentBreakdown.transactionCost'),
      runningCost: asNonNegative(ib.runningCost, 'data.investmentBreakdown.runningCost'),
    },
    features: features as Record<string, number>,
    images: d.images == null ? [] : asStringArray(d.images, 'data.images'),
    sell: {
      percentToSell: asPositive(sell.percentToSell, 'data.sell.percentToSell', 100),
      ...(sell.remainingPercent != null && { remainingPercent: asNonNegative(sell.remainingPercent, 'data.sell.remainingPercent') }),
    },
  };
  if (d.proofOfOwnership != null) out.proofOfOwnership = asString(d.proofOfOwnership, 'data.proofOfOwnership');
  if (d.description != null) {
    const desc = asObject(d.description, 'data.description');
    out.description = {
      details: desc.details == null ? '' : asString(desc.details, 'data.description.details'),
      features: desc.features == null ? [] : asStringArray(desc.features, 'data.description.features'),
    };
  }
  if (d.whyInvest != null) {
    if (!Array.isArray(d.whyInvest)) throw new ValidationError('data.whyInvest must be an array');
    out.whyInvest = d.whyInvest.map((w, i) => {
      const o = asObject(w, `data.whyInvest[${i}]`);
      return { title: asString(o.title ?? '', `data.whyInvest[${i}].title`), text: asString(o.text ?? '', `data.whyInvest[${i}].text`) };
    });
  }
  return out;
}

export function parseCreateProperty(body: unknown) {
  const b = asObject(body, 'body');
  return {
    data: parsePropertyData(b.data),
    paymentTxAction: asActionResult(b.paymentTxAction, 'paymentTxAction'),
    paymentNonce: short(b.paymentNonce, 'paymentNonce'),
    seller: asMatch(b.seller, 'seller', PUBKEY),
  };
}
