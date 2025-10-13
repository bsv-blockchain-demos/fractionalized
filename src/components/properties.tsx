"use client";

import { dummyProperties } from '../lib/dummydata';
import { useMemo, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FilterSortModal, type FilterState, type SortOption } from './filter-sort-modal';
import PropertyGrid from './properties/PropertyGrid';

type Status = 'all' | 'upcoming' | 'open' | 'funded' | 'sold';

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

export function Properties() {
    const [activeStatus, setActiveStatus] = useState<Status>('all');
    const [isFilterOpen, setFilterOpen] = useState(false);
    const [filters, setFilters] = useState<FilterState>(defaultFilters);
    const [sortBy, setSortBy] = useState<SortOption>('price_desc');
    const [properties, setProperties] = useState<any[]>([]);
    const [page, setPage] = useState<number>(1);
    const PAGE_SIZE = 20;
    const [total, setTotal] = useState<number>(0);
    const [loading, setLoading] = useState<boolean>(false);
    const router = useRouter();
    const searchParams = useSearchParams();

    // Initialize state from URL on mount
    useEffect(() => {
        const sp = new URLSearchParams(searchParams?.toString());
        const p = Number(sp.get('page') || '1');
        const sb = (sp.get('sortBy') as SortOption) || 'price_desc';
        const as = (sp.get('status') as Status) || 'all';
        const fParam = sp.get('filters');
        try {
            if (p && p > 0) setPage(p);
            if (sb) setSortBy(sb);
            if (as) setActiveStatus(as);
            if (fParam) {
                const parsed = JSON.parse(fParam);
                if (parsed && typeof parsed === 'object') setFilters(parsed);
            }
        } catch {}
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const fetchProperties = async () => {
            try {
                setLoading(true);
                // Build query string for GET and update URL so back/forward works
                const qs = new URLSearchParams();
                qs.set('page', String(page));
                qs.set('limit', String(PAGE_SIZE));
                qs.set('sortBy', sortBy);
                qs.set('activeStatus', activeStatus);
                if (filters) qs.set('filters', JSON.stringify(filters));

                const url = `/api/properties?${qs.toString()}`;
                // Reflect same params in browser URL (without navigating away)
                const viewQS = new URLSearchParams();
                viewQS.set('page', String(page));
                viewQS.set('sortBy', sortBy);
                viewQS.set('status', activeStatus);
                viewQS.set('filters', JSON.stringify(filters));
                router.push(`?${viewQS.toString()}`);

                const response = await fetch(url, { method: 'GET' });
                if (!response.ok) {
                    setProperties(dummyProperties);
                    setTotal(dummyProperties.length);
                    return;
                }
                const data = await response.json();
                setProperties(data.items || []);
                setTotal(data.total || 0);
            } catch (e) {
                setProperties(dummyProperties);
                setTotal(dummyProperties.length);
            } finally {
                setLoading(false);
            }
        };
        fetchProperties();
    }, [filters, sortBy, activeStatus, page]);

    const parsePercent = (s: string) => {
        const n = parseFloat(String(s).replace('%', ''));
        return isNaN(n) ? 0 : n;
    };

    const filtered = useMemo(() => {
        // Server already handled filtering and sorting; just return the page of results
        return properties;
    }, [properties]);

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const tabs: { key: Status; label: string }[] = [
        { key: 'all', label: 'All' },
        { key: 'upcoming', label: 'Upcoming' },
        { key: 'open', label: 'Open' },
        { key: 'funded', label: 'Funded' },
        { key: 'sold', label: 'Sold' },
    ];
    const formatCurrency = (amount: number) => {
        return `USD ${amount.toLocaleString()}`;
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
                                onClick={() => { setActiveStatus(t.key); setPage(1); }}
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
            <div className="mb-2 text-sm text-text-primary">{total} properties</div>
            <div className="section-divider"></div>

            {/* Loading state */}
            {loading && (
                <div className="flex items-center justify-center py-10">
                    <svg className="animate-spin h-6 w-6 text-accent-primary mr-3" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                    </svg>
                    <span className="text-sm text-text-secondary">Loading properties...</span>
                </div>
            )}

            {/* Grid */}
            <PropertyGrid items={filtered as any} />

            {/* Pagination Controls */}
            <div className="mt-6 flex items-center justify-center gap-4">
                <button
                    type="button"
                    className="px-4 py-2 rounded-lg border border-border-subtle bg-bg-secondary text-text-primary text-sm btn-glow disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1 || loading}
                >
                    ← Previous
                </button>
                <div className="text-sm text-text-secondary">Page {page} of {totalPages}</div>
                <button
                    type="button"
                    className="px-4 py-2 rounded-lg border border-border-subtle bg-bg-secondary text-text-primary text-sm btn-glow disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page >= totalPages || loading}
                >
                    Next →
                </button>
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
                    setPage(1);
                    setFilterOpen(false);
                }}
            />
        </div>
    );
}