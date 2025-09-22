"use client";

import { properties } from '../lib/dummydata';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { FilterSortModal, type FilterState, type SortOption } from './filter-sort-modal';

type Status = 'all' | 'upcoming' | 'open' | 'funded' | 'sold';

export function Properties() {
    const [activeStatus, setActiveStatus] = useState<Status>('all');
    const [isFilterOpen, setFilterOpen] = useState(false);

    const defaultFilters: FilterState = {
        priceMin: undefined,
        priceMax: undefined,
        investorsMin: undefined,
        investorsMax: undefined,
        grossYieldMin: undefined,
        grossYieldMax: undefined,
        netYieldMin: undefined,
        netYieldMax: undefined,
        annualisedReturnMin: undefined,
        annualisedReturnMax: undefined,
        statuses: ['upcoming', 'open', 'funded', 'sold'],
        query: '',
    };
    const [filters, setFilters] = useState<FilterState>(defaultFilters);
    const [sortBy, setSortBy] = useState<SortOption>('price_desc');

    const parsePercent = (s: string) => {
        const n = parseFloat(String(s).replace('%', ''));
        return isNaN(n) ? 0 : n;
    };

    const filtered = useMemo(() => {
        // Base filter by tab status
        let list = (activeStatus === 'all') ? properties : properties.filter((p: any) => p.status === activeStatus);

        // Apply filter modal criteria
        list = list.filter((p) => {
            // status set
            if (!filters.statuses.includes(p.status as any)) return false;

            // query search
            const q = (filters.query || '').trim().toLowerCase();
            if (q) {
                const hay = `${p.title} ${p.location}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }

            // numeric ranges
            if (filters.priceMin != null && p.priceAED < filters.priceMin) return false;
            if (filters.priceMax != null && p.priceAED > filters.priceMax) return false;
            if (filters.investorsMin != null && p.investors < filters.investorsMin) return false;
            if (filters.investorsMax != null && p.investors > filters.investorsMax) return false;

            const gross = parsePercent(p.grossYield);
            const net = parsePercent(p.netYield);
            const ann = parsePercent(p.annualisedReturn);
            if (filters.grossYieldMin != null && gross < filters.grossYieldMin) return false;
            if (filters.grossYieldMax != null && gross > filters.grossYieldMax) return false;
            if (filters.netYieldMin != null && net < filters.netYieldMin) return false;
            if (filters.netYieldMax != null && net > filters.netYieldMax) return false;
            if (filters.annualisedReturnMin != null && ann < filters.annualisedReturnMin) return false;
            if (filters.annualisedReturnMax != null && ann > filters.annualisedReturnMax) return false;

            return true;
        });

        // Sorting
        const sorted = [...list];
        sorted.sort((a, b) => {
            switch (sortBy) {
                case 'price_asc':
                    return a.priceAED - b.priceAED;
                case 'price_desc':
                    return b.priceAED - a.priceAED;
                case 'valuation_asc':
                    return a.currentValuationAED - b.currentValuationAED;
                case 'valuation_desc':
                    return b.currentValuationAED - a.currentValuationAED;
                case 'investors_asc':
                    return a.investors - b.investors;
                case 'investors_desc':
                    return b.investors - a.investors;
                case 'gross_yield_desc':
                    return parsePercent(b.grossYield) - parsePercent(a.grossYield);
                case 'gross_yield_asc':
                    return parsePercent(a.grossYield) - parsePercent(b.grossYield);
                case 'net_yield_desc':
                    return parsePercent(b.netYield) - parsePercent(a.netYield);
                case 'net_yield_asc':
                    return parsePercent(a.netYield) - parsePercent(b.netYield);
                case 'annualised_desc':
                    return parsePercent(b.annualisedReturn) - parsePercent(a.annualisedReturn);
                case 'annualised_asc':
                    return parsePercent(a.annualisedReturn) - parsePercent(b.annualisedReturn);
                default:
                    return 0;
            }
        });

        return sorted;
    }, [activeStatus, filters, sortBy]);

    const tabs: { key: Status; label: string }[] = [
        { key: 'all', label: 'All' },
        { key: 'upcoming', label: 'Upcoming' },
        { key: 'open', label: 'Open' },
        { key: 'funded', label: 'Funded' },
        { key: 'sold', label: 'Sold' },
    ];
    const formatCurrency = (amount: number) => {
        return `AED ${amount.toLocaleString()}`;
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric' 
        });
    };

    return (
        <div className="container mx-auto px-4 py-4">
            {/* Header controls */}
            <div className="mb-4 flex items-center justify-between">
                {/* Segmented tabs */}
                <div className="inline-flex rounded-lg border border-border-subtle bg-bg-secondary overflow-hidden">
                    {tabs.map((t, idx) => {
                        const isActive = t.key === activeStatus;
                        return (
                            <button
                                key={t.key}
                                onClick={() => setActiveStatus(t.key)}
                                className={[
                                    'px-4 py-2 text-sm transition-colors btn-glow',
                                    isActive
                                        ? 'bg-accent-primary text-white border border-transparent'
                                        : 'text-text-secondary hover:text-text-primary',
                                    idx !== tabs.length - 1 ? 'border-r border-border-subtle' : '',
                                ].join(' ')}
                                aria-pressed={isActive}
                                type="button"
                            >
                                {t.label}
                            </button>
                        );
                    })}
                </div>

                {/* Filter & sort button (opens modal) */}
                <button type="button" onClick={() => setFilterOpen(true)} className="px-4 py-2 rounded-lg border border-border-subtle bg-bg-secondary text-text-primary hover:text-accent-primary transition-colors text-sm inline-flex items-center gap-2 btn-glow">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18M7 12h10M11 18h2"/>
                    </svg>
                    Filter & sort
                </button>
            </div>

            {/* Count and divider */}
            <div className="mb-2 text-sm text-text-primary">{filtered.length} properties</div>
            <div className="section-divider"></div>

            {/* Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filtered.map((property) => (
                    <Link key={property._id.toString()} href={`/properties/${property._id.toString()}`} className="block">
                        <div className="card-glass overflow-hidden transition-all cursor-pointer group">
                            {/* Property Image */}
                            <div className="relative h-48 bg-gradient-to-br from-accent-primary to-accent-hover">
                                {/* Status Badge */}
                                <div
                                    className={
                                        `absolute top-3 left-3 ` +
                                        (property.status === 'funded'
                                            ? 'badge-success'
                                            : property.status === 'open'
                                                ? 'badge-dark'
                                                : property.status === 'upcoming'
                                                    ? 'badge-dark'
                                                    : 'badge-dark')
                                    }
                                >
                                    {String(property.status || '').toUpperCase()}
                                </div>
                                {/* Image pagination indicator */}
                                <div className="absolute bottom-3 right-3 badge-dark text-xs">1/{Math.floor(Math.random() * 9) + 1}</div>
                                {/* Placeholder for property image */}
                                <div className="w-full h-full flex items-center justify-center opacity-60">
                                    <div className="text-white text-sm">Property Image</div>
                                </div>
                            </div>

                            {/* Property Details */}
                            <div className="p-4">
                                {/* Location */}
                                <p className="text-xs text-text-secondary mb-1">{property.location}</p>

                                {/* Title */}
                                <h3 className="text-lg font-semibold text-text-primary mb-3 line-clamp-2">
                                    {property.title}
                                </h3>

                                {/* Price and Investors */}
                                <div className="flex justify-between items-center mb-4">
                                    <div className="text-xl font-bold text-text-primary">
                                        {formatCurrency(property.priceAED)}
                                    </div>
                                    <div className="text-sm text-text-secondary">
                                        {property.investors} investors
                                    </div>
                                </div>

                                {/* Investment Metrics */}
                                <div className="space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-text-secondary">Annualised return</span>
                                        <span className="font-medium text-text-primary">{property.annualisedReturn}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-text-secondary">Current valuation</span>
                                        <span className="font-medium text-text-primary">{formatCurrency(property.currentValuationAED)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-text-secondary">Gross yield</span>
                                        <span className="font-medium text-text-primary">{property.grossYield}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Link>
                ))}
            </div>

            {/* Modal */}
            <FilterSortModal
                isOpen={isFilterOpen}
                onClose={() => setFilterOpen(false)}
                initialFilters={filters}
                initialSort={sortBy}
                onApply={(f, s) => {
                    setFilters(f);
                    setSortBy(s);
                    setFilterOpen(false);
                }}
            />
        </div>
    );
}