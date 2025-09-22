"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "./modal";

export type Status = "upcoming" | "open" | "funded" | "sold";

export type FilterState = {
  priceMin?: number;
  priceMax?: number;
  investorsMin?: number;
  investorsMax?: number;
  grossYieldMin?: number; // percent
  grossYieldMax?: number; // percent
  netYieldMin?: number; // percent
  netYieldMax?: number; // percent
  annualisedReturnMin?: number; // percent
  annualisedReturnMax?: number; // percent
  statuses: Status[]; // which statuses to include
  query?: string; // simple search by title/location
};

export type SortOption =
  | "price_asc"
  | "price_desc"
  | "valuation_asc"
  | "valuation_desc"
  | "investors_asc"
  | "investors_desc"
  | "gross_yield_desc"
  | "gross_yield_asc"
  | "net_yield_desc"
  | "net_yield_asc"
  | "annualised_desc"
  | "annualised_asc";

export function FilterSortModal({
  isOpen,
  onClose,
  initialFilters,
  initialSort,
  onApply,
}: {
  isOpen: boolean;
  onClose: () => void;
  initialFilters: FilterState;
  initialSort: SortOption;
  onApply: (filters: FilterState, sort: SortOption) => void;
}) {
  const [filters, setFilters] = useState<FilterState>(initialFilters);
  const [sort, setSort] = useState<SortOption>(initialSort);

  useEffect(() => {
    if (isOpen) {
      setFilters(initialFilters);
      setSort(initialSort);
    }
  }, [isOpen, initialFilters, initialSort]);

  const statusOptions: { key: Status; label: string }[] = useMemo(
    () => [
      { key: "upcoming", label: "Upcoming" },
      { key: "open", label: "Open" },
      { key: "funded", label: "Funded" },
      { key: "sold", label: "Sold" },
    ],
    []
  );

  const sortOptions: { key: SortOption; label: string }[] = [
    { key: "price_asc", label: "Price: Low to High" },
    { key: "price_desc", label: "Price: High to Low" },
    { key: "valuation_asc", label: "Valuation: Low to High" },
    { key: "valuation_desc", label: "Valuation: High to Low" },
    { key: "investors_asc", label: "Investors: Few to Many" },
    { key: "investors_desc", label: "Investors: Many to Few" },
    { key: "gross_yield_desc", label: "Gross yield: High to Low" },
    { key: "gross_yield_asc", label: "Gross yield: Low to High" },
    { key: "net_yield_desc", label: "Net yield: High to Low" },
    { key: "net_yield_asc", label: "Net yield: Low to High" },
    { key: "annualised_desc", label: "Annualised return: High to Low" },
    { key: "annualised_asc", label: "Annualised return: Low to High" },
  ];

  const updateStatuses = (s: Status, checked: boolean) => {
    setFilters((prev) => {
      const set = new Set(prev.statuses);
      if (checked) set.add(s);
      else set.delete(s);
      return { ...prev, statuses: Array.from(set) as Status[] };
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Filter & sort">
      <div className="space-y-5">
        {/* Search */}
        <div>
          <div className="text-sm text-text-secondary mb-2">Search</div>
          <input
            type="text"
            placeholder="Search by title or location"
            value={filters.query || ""}
            onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
            className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-secondary text-text-primary"
          />
        </div>

        {/* Price range */}
        <div>
          <div className="text-sm text-text-secondary mb-2">Price (AED)</div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input
              type="number"
              min={0}
              value={filters.priceMin ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, priceMin: Number(e.target.value || 0) }))}
              placeholder="Min"
              className="px-3 py-2 rounded border border-border-subtle bg-bg-secondary text-text-primary"
            />
            <input
              type="number"
              min={0}
              value={filters.priceMax ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, priceMax: Number(e.target.value || 0) }))}
              placeholder="Max"
              className="px-3 py-2 rounded border border-border-subtle bg-bg-secondary text-text-primary"
            />
          </div>
        </div>

        {/* Investors */}
        <div>
          <div className="text-sm text-text-secondary mb-2">Investors</div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input
              type="number"
              min={0}
              value={filters.investorsMin ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, investorsMin: Number(e.target.value || 0) }))}
              placeholder="Min"
              className="px-3 py-2 rounded border border-border-subtle bg-bg-secondary text-text-primary"
            />
            <input
              type="number"
              min={0}
              value={filters.investorsMax ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, investorsMax: Number(e.target.value || 0) }))}
              placeholder="Max"
              className="px-3 py-2 rounded border border-border-subtle bg-bg-secondary text-text-primary"
            />
          </div>
        </div>

        {/* Percents */}
        <div className="grid grid-cols-1 gap-4">
          <div>
            <div className="text-sm text-text-secondary mb-2">Gross yield (%)</div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                min={0}
                step={0.01}
                value={filters.grossYieldMin ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, grossYieldMin: Number(e.target.value || 0) }))}
                placeholder="Min"
                className="px-3 py-2 rounded border border-border-subtle bg-bg-secondary text-text-primary"
              />
              <input
                type="number"
                min={0}
                step={0.01}
                value={filters.grossYieldMax ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, grossYieldMax: Number(e.target.value || 0) }))}
                placeholder="Max"
                className="px-3 py-2 rounded border border-border-subtle bg-bg-secondary text-text-primary"
              />
            </div>
          </div>
          <div>
            <div className="text-sm text-text-secondary mb-2">Net yield (%)</div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                min={0}
                step={0.01}
                value={filters.netYieldMin ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, netYieldMin: Number(e.target.value || 0) }))}
                placeholder="Min"
                className="px-3 py-2 rounded border border-border-subtle bg-bg-secondary text-text-primary"
              />
              <input
                type="number"
                min={0}
                step={0.01}
                value={filters.netYieldMax ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, netYieldMax: Number(e.target.value || 0) }))}
                placeholder="Max"
                className="px-3 py-2 rounded border border-border-subtle bg-bg-secondary text-text-primary"
              />
            </div>
          </div>
          <div>
            <div className="text-sm text-text-secondary mb-2">Annualised return (%)</div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                min={0}
                step={0.01}
                value={filters.annualisedReturnMin ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, annualisedReturnMin: Number(e.target.value || 0) }))}
                placeholder="Min"
                className="px-3 py-2 rounded border border-border-subtle bg-bg-secondary text-text-primary"
              />
              <input
                type="number"
                min={0}
                step={0.01}
                value={filters.annualisedReturnMax ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, annualisedReturnMax: Number(e.target.value || 0) }))}
                placeholder="Max"
                className="px-3 py-2 rounded border border-border-subtle bg-bg-secondary text-text-primary"
              />
            </div>
          </div>
        </div>

        {/* Statuses */}
        <div>
          <div className="text-sm text-text-secondary mb-2">Statuses</div>
          <div className="grid grid-cols-2 gap-2">
            {statusOptions.map((s) => {
              const checked = filters.statuses.includes(s.key);
              return (
                <label key={s.key} className="inline-flex items-center gap-2 text-sm text-text-primary">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => updateStatuses(s.key, e.target.checked)}
                  />
                  <span>{s.label}</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Sort */}
        <div>
          <div className="text-sm text-text-secondary mb-2">Sort by</div>
          <select
            className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-secondary text-text-primary"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortOption)}
          >
            {sortOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            className="px-4 py-2 rounded-lg border border-border-subtle bg-bg-secondary text-text-primary text-sm btn-glow"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-hover transition-colors text-sm btn-glow border border-transparent"
            onClick={() => onApply(filters, sort)}
          >
            Apply
          </button>
        </div>
      </div>
    </Modal>
  );
}
