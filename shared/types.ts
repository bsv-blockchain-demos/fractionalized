// Mongo document shapes. Dual-use: the server queries them, the client renders them.
// `import type` is REQUIRED — a runtime `import { ObjectId } from 'mongodb'` here
// would pull the Mongo driver into the browser bundle. ObjectId is used only in
// type positions below.
import type { ObjectId } from 'mongodb';

export interface Properties {
  _id: ObjectId;
  title: string;
  location: string;
  priceUSD: number;
  investors: number;
  status: string;
  annualisedReturn: string;
  currentValuationUSD: number;
  grossYield: string;
  netYield: string;
  investmentBreakdown: {
    purchaseCost: number;
    transactionCost: number;
    runningCost: number;
  },
  features: Record<string, number>,
  images: string[],
  txids: {
    tokenTxid: string;
    originalMintTxid?: string; // Immutable original mint transaction
    currentOutpoint?: string; // Current UTXO for next purchase (change output)
    paymentTxid?: string;
    mintTxid?: string; // Deprecated - kept for backward compatibility (read fallback only)
  },
  // How to spend `txids.currentOutpoint`: per-output type-42 derivation + carry-forward BEEF.
  currentDerivation?: {
    keyId: string;
    counterparty: string;
    counterpartyDerivedKey: string;
    order: 'self-first' | 'self-second';
    beef: string; // base64 of the tx that created currentOutpoint
  },
  // How to spend the payment-change UTXO (txids.paymentTxid): per-output type-42 derivation.
  paymentDerivation?: {
    keyId: string;
    counterparty: string;            // user (seller) identity key
    counterpartyDerivedKey: string;  // user's derived child
    order: 'self-first' | 'self-second';
  },
  seller: string,
  sell?: {
    percentToSell: number;
    remainingPercent?: number; // Tracks remaining shares available for purchase
  },
  proofOfOwnership?: string, // Base64 encoded PDF document
}

export interface PropertyDescription {
  _id?: ObjectId;
  propertyId: ObjectId;
  description: {
    details: string;
    features: string[];
  };
  whyInvest?: { title: string; text: string }[];
}

export interface ShareLock {
  _id: ObjectId;
  propertyId: ObjectId;
  investorId: string;
  createdAt: Date;
}

export interface Shares {
  _id: ObjectId;
  propertyId: ObjectId;
  investorId: string;
  parentTxid: string;
  transferTxid: string;
  amount: number;
  createdAt: Date;
  keyId?: string;
  counterparty?: string;
  counterpartyDerivedKey?: string;
  order?: 'self-first' | 'self-second';
}

export interface MarketItem {
  _id: ObjectId; // mongo id
  propertyId: ObjectId; // property id
  sellerId: string; // seller pubkey
  shareId: ObjectId; // share id
  sellAmount: number; // sell amount
  pricePerShare: number; // price per share
  createdAt: Date; // created at
  sold?: boolean; // sold
  // Listing multisig(seller+server) derivation, server's perspective (spends deriving against seller).
  keyId?: string;
  counterparty?: string;          // sellerId identity key
  counterpartyDerivedKey?: string; // sellerChild
  order?: 'self-first' | 'self-second';
};

export interface ListingBeef {
  _id?: ObjectId;
  listingId: string;       // market_items _id as string
  listingOutpoint: string; // the listing multisig outpoint
  beef: string;            // base64
  createdAt: Date;
}
