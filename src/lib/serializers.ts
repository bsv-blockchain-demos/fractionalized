import type { Properties } from "./mongo";

export interface PublicProperty {
  _id: string;
  title?: string;
  location?: string;
  priceUSD?: number;
  status?: string;
  annualisedReturn?: string;
  currentValuationUSD?: number;
  grossYield?: string;
  netYield?: string;
  investmentBreakdown?: Properties["investmentBreakdown"];
  features?: Record<string, number>;
  images?: string[];
  sell?: { percentToSell: number; remainingPercent?: number };
  availablePercent?: number | null;
  totalSold?: number;
  investors?: number;
  txids?: { tokenTxid?: string };
}

// Built by explicit construction: any field NOT listed here is excluded by default,
// so new schema fields can never accidentally leak.
export function toPublicProperty(
  property: Properties,
  computed?: { availablePercent?: number | null; totalSold?: number; investors?: number },
): PublicProperty {
  return {
    _id: String((property as { _id: unknown })._id),
    title: property.title,
    location: property.location,
    priceUSD: property.priceUSD,
    status: property.status,
    annualisedReturn: property.annualisedReturn,
    currentValuationUSD: property.currentValuationUSD,
    grossYield: property.grossYield,
    netYield: property.netYield,
    investmentBreakdown: property.investmentBreakdown,
    features: property.features,
    images: property.images,
    sell: property.sell
      ? { percentToSell: property.sell.percentToSell, remainingPercent: property.sell.remainingPercent }
      : undefined,
    availablePercent: computed?.availablePercent,
    totalSold: computed?.totalSold,
    investors: computed?.investors ?? property.investors,
    txids: property.txids?.tokenTxid ? { tokenTxid: property.txids.tokenTxid } : undefined,
  };
}
