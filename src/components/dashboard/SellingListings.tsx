"use client";

import Link from "next/link";
import React from "react";
import { type Property } from "../../lib/dummydata";

export interface SellingListingsProps {
  selling: Property[];
  onListProperty?: () => void;
}

const formatCurrency = (amount: number) => `USD ${amount.toLocaleString()}`;

export default function SellingListings({ selling, onListProperty }: SellingListingsProps) {
  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-bold text-text-primary">Your Listings (Selling)</h2>
        <button
          type="button"
          className="px-3 py-1.5 rounded-lg border border-border-subtle bg-bg-secondary text-sm text-text-primary btn-glow"
          onClick={onListProperty}
        >
          List a property
        </button>
      </div>
      {selling.length === 0 ? (
        <div className="p-4 rounded-lg bg-bg-tertiary border border-border-subtle text-sm text-text-secondary">
          You don't have any listings yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {selling.map((property) => (
            <Link key={property._id} href={`/properties/${property._id}`} className="block">
              <div className="card-glass p-4">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-text-primary">{property.title}</h3>
                  <span className="badge-dark text-xs">Selling</span>
                </div>
                <p className="text-xs text-text-secondary mb-2">{property.location}</p>
                <div className="text-sm text-text-primary">Asking: {formatCurrency(property.priceUSD)}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
