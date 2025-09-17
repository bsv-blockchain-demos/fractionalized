"use client";

import { properties } from '../lib/dummydata';
import Link from 'next/link';
import { useMemo, useState } from 'react';

type Status = 'all' | 'upcoming' | 'open' | 'funded' | 'sold';

export function Properties() {
    const [activeStatus, setActiveStatus] = useState<Status>('all');

    const filtered = useMemo(() => {
        if (activeStatus === 'all') return properties;
        return properties.filter((p: any) => p.status === activeStatus);
    }, [activeStatus]);

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
                                    'px-4 py-2 text-sm transition-colors',
                                    isActive
                                        ? 'bg-accent-primary text-white'
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

                {/* Filter & sort button (non-functional placeholder) */}
                <button type="button" className="px-4 py-2 rounded-lg border border-border-subtle bg-bg-secondary text-text-primary hover:text-accent-primary transition-colors text-sm inline-flex items-center gap-2">
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
                    <Link key={property.id} href={`/properties/${property.id}`} className="block">
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
                                        <span className="text-text-secondary">Funded date</span>
                                        <span className="font-medium text-text-primary">{formatDate(property.fundedDate)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    );
}