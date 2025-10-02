"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type MarketItem = {
  _id: string; // mongo id
  propertyId: string; // property id
  sellerId: string; // seller id
  shareId: string; // share id
  sellAmount: number; // sell amount
};

type PropertyMeta = {
  name: string;
  location: string;
  pricePerShareUsd: number;
};

// Temporary property metadata lookup. Replace with API route using propertyId.
const DUMMY_PROPERTIES: Record<string, PropertyMeta> = {
  "6710c9c0f1a2b2f8a1c00111": {
    name: "Sunset Villas",
    location: "Austin, TX",
    pricePerShareUsd: 125,
  },
  "6710c9c0f1a2b2f8a1c00222": {
    name: "Harbor Lofts",
    location: "Seattle, WA",
    pricePerShareUsd: 125,
  },
  "6710c9c0f1a2b2f8a1c00333": {
    name: "Pineview Homes",
    location: "Denver, CO",
    pricePerShareUsd: 125,
  },
  "6710c9c0f1a2b2f8a1c00444": {
    name: "Lakeside Retreat",
    location: "Madison, WI",
    pricePerShareUsd: 125,
  },
};

// TODO: Replace this with a Mongo fetch (e.g., from `/api/properties`)
const DUMMY_ITEMS: MarketItem[] = [
  {
    _id: "m1",
    propertyId: "6710c9c0f1a2b2f8a1c00111",
    sellerId: "s001",
    shareId: "sh001",
    sellAmount: 5,
  },
  {
    _id: "m2",
    propertyId: "6710c9c0f1a2b2f8a1c00222",
    sellerId: "s002",
    shareId: "sh002",
    sellAmount: 12,
  },
  {
    _id: "m3",
    propertyId: "6710c9c0f1a2b2f8a1c00333",
    sellerId: "s003",
    shareId: "sh003",
    sellAmount: 2,
  },
  {
    _id: "m4",
    propertyId: "6710c9c0f1a2b2f8a1c00444",
    sellerId: "s004",
    shareId: "sh004",
    sellAmount: 20,
  },
];

type UIItem = MarketItem & PropertyMeta;

const sortFns: Record<string, (a: UIItem, b: UIItem) => number> = {
  "relevance": () => 0,
  "price-asc": (a, b) => a.pricePerShareUsd - b.pricePerShareUsd,
  "price-desc": (a, b) => b.pricePerShareUsd - a.pricePerShareUsd,
  "amount-desc": (a, b) => b.sellAmount - a.sellAmount,
};

export function Marketplace() {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<keyof typeof sortFns>("relevance");

  const uiItems: UIItem[] = useMemo(() => {
    // Merge market items with property meta using propertyId
    return DUMMY_ITEMS.map((mi) => {
      const meta = DUMMY_PROPERTIES[mi.propertyId];
      return {
        ...mi,
        ...(meta || {
          name: "Unknown Property",
          location: "Unknown",
          pricePerShareUsd: 0,
          availablePercent: 0,
          totalShares: 0,
        }),
      } as UIItem;
    });
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? uiItems.filter((i) => `${i.name} ${i.location}`.toLowerCase().includes(q))
      : uiItems;
    const sorter = sortFns[sort] || sortFns["relevance"];
    return [...base].sort(sorter);
  }, [query, sort, uiItems]);

  return (
    <div className="container mx-auto px-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-text-primary">Marketplace</h1>
      </div>

      <div className="bg-bg-secondary border border-border-subtle rounded-xl p-4 mb-6">
        <div className="flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex-1">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or location"
              className="w-full rounded-lg border border-border-subtle bg-bg-primary text-text-primary placeholder-text-muted px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
            />
          </div>
          <div className="w-full md:w-56">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as keyof typeof sortFns)}
              className="w-full rounded-lg border border-border-subtle bg-bg-primary text-text-primary px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
            >
              <option value="relevance">Sort: Relevance</option>
              <option value="price-asc">Price per share: Low to High</option>
              <option value="price-desc">Price per share: High to Low</option>
              <option value="availability-desc">Availability: High to Low</option>
              <option value="amount-desc">For sale amount: High to Low</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {filtered.map((item) => (
          <div
            key={item._id}
            className="card-glass group bg-bg-secondary border border-border-subtle rounded-xl overflow-hidden hover:shadow-md transition-shadow"
          >
            {/* Image placeholder */}
            <div className="h-36 bg-bg-primary/60 flex items-center justify-center">
              <div className="w-14 h-14 bg-accent-primary/20 rounded-lg flex items-center justify-center">
                <span className="text-accent-primary font-semibold">IMG</span>
              </div>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <h3 className="text-lg font-semibold text-text-primary leading-snug">
                  {item.name}
                </h3>
                <p className="text-sm text-text-secondary">{item.location}</p>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-text-secondary">Price / share</p>
                  <p className="text-text-primary font-medium">${""}{item.pricePerShareUsd.toFixed(0)}</p>
                </div>
              </div>

              <p className="text-xs text-text-secondary">For sale: {item.sellAmount}</p>

              <div className="flex items-center gap-2 pt-1">
                <Link
                  href={`/properties/${item.propertyId}`}
                  className="flex-1 text-center bg-bg-primary hover:bg-bg-primary/80 text-text-primary border border-border-subtle rounded-lg px-3 py-2 transition-colors btn-glow"
                >
                  View
                </Link>
                <button
                  type="button"
                  onClick={() => alert(`Buy flow placeholder for share ${item.shareId}`)}
                  className="flex-1 text-center bg-accent-primary hover:bg-accent-primary/90 text-white rounded-lg px-3 py-2 transition-colors btn-glow"
                >
                  Buy
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center text-text-secondary py-16 border border-dashed border-border-subtle rounded-xl">
          No results. Try a different search.
        </div>
      )}
    </div>
  );
}