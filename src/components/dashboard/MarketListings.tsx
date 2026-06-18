"use client";

import Link from "next/link";
import React from "react";
import { Spinner } from "../spinner";

export interface MarketListingItem {
  _id: string;
  propertyId: string;
  name: string;
  location: string;
  sellAmount: number;
  pricePerShare: number;
  listingNonce?: string;
  listingOutpoint?: string;
  listingBeef?: string;
  tokenTxid?: string;
}

export interface MarketListingsProps {
  loading: boolean;
  items: MarketListingItem[];
  onCancel?: (item: MarketListingItem) => void;
  cancellingId?: string | null;
}

export default function MarketListings({ loading, items, onCancel, cancellingId }: MarketListingsProps) {
  if (loading) {
    return (
      <div className="p-4 rounded-lg bg-bg-tertiary border border-border-subtle text-sm text-text-secondary mb-8">
        <div className="flex items-center gap-3">
          <Spinner size={16} />
          <span>Loading your market listings...</span>
        </div>
      </div>
    );
  }

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-bold text-text-primary">Your Market Listings</h2>
      </div>
      {(!items || items.length === 0) ? (
        <div className="p-4 rounded-lg bg-bg-tertiary border border-border-subtle text-sm text-text-secondary">
          You don&apos;t have any listings yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map((item) => {
            const isCancelling = cancellingId === item._id;
            return (
              <div key={item._id} className="card-glass p-4 flex flex-col">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-text-primary">{item.name}</h3>
                  <span className="badge-dark text-xs">Selling</span>
                </div>
                <p className="text-xs text-text-secondary mb-2">{item.location}</p>
                <div className="text-sm text-text-secondary">Amount: {item.sellAmount}%</div>
                <div className="text-sm text-text-primary">Price/share: AED {item.pricePerShare.toLocaleString()}</div>
                <div className="mt-3 flex items-center gap-2">
                  <Link
                    href={`/properties/${item.propertyId}`}
                    className="flex-1 text-center px-3 py-1.5 rounded-lg border border-border-subtle bg-bg-secondary text-sm text-text-primary btn-glow"
                  >
                    View
                  </Link>
                  {onCancel && (
                    <button
                      type="button"
                      disabled={isCancelling || !!cancellingId}
                      onClick={() => onCancel(item)}
                      className="flex-1 text-center px-3 py-1.5 rounded-lg border border-border-subtle bg-bg-secondary text-sm text-red-400 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed btn-glow"
                    >
                      {isCancelling ? "Cancelling..." : "Cancel listing"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
