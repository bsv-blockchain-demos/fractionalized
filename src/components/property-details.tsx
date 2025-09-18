"use client";

import { properties } from '../lib/dummydata';
import Link from 'next/link';

export function PropertyDetails({ propertyId }: { propertyId: string }) {
    const property = properties.find(p => p._id.toString() === propertyId);
    
    if (!property) {
        return <div>Property not found</div>;
    }

    const formatCurrency = (amount: number) => {
        return `AED ${amount.toLocaleString()}`;
    };

    const getFeatureIcon = (name: string) => {
        const key = name.toLowerCase();
        if (key.includes('bedroom') || key.includes('studio')) return '🛏️';
        if (key.includes('bath')) return '🚿';
        if (key.includes('kitchen')) return '🍳';
        if (key.includes('living')) return '🛋️';
        return '🏷️';
    };

    return (
        <div className="container mx-auto px-4 py-6">
            {/* Breadcrumb */}
            <nav className="text-sm mb-6 text-text-secondary">
                <Link href="/properties" className="link-accent hover:cursor-pointer">
                    Properties
                </Link>
                <span className="mx-2">›</span>
                <span>{property.title}</span>
            </nav>

            {/* Property Header */}
            <div className="mb-8">
                <p className="text-sm mb-2 text-text-secondary">{property.location}</p>
                <div className="flex justify-between items-start mb-4">
                    <h1 className="text-3xl font-bold text-text-primary">{property.title}</h1>
                    <div className="text-right">
                        <div className="text-3xl font-bold mb-2 text-text-primary">
                            {formatCurrency(property.priceAED)}
                        </div>
                        <div className="flex items-center gap-4">
                            <span className="px-3 py-1 rounded text-sm font-medium badge-success">{property.status.toUpperCase()}</span>
                            <span className="text-sm text-text-secondary">
                                {property.investors} investors
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Investment Metrics */}
            <div className="grid grid-cols-3 gap-8 mb-8 p-6 rounded-lg card">
                <div>
                    <div className="text-sm mb-1 text-text-secondary">Gross yield</div>
                    <div className="text-xl font-bold text-accent-primary">{property.grossYield}</div>
                </div>
                <div>
                    <div className="text-sm mb-1 text-text-secondary">Net yield</div>
                    <div className="text-xl font-bold" style={{ color: 'var(--success)' }}>{property.netYield}</div>
                </div>
                <div>
                    <div className="text-sm mb-1 text-text-secondary">Annualised return</div>
                    <div className="text-xl font-bold" style={{ color: 'var(--info)' }}>{property.annualisedReturn}</div>
                </div>
            </div>

            {/* Need help section */}
            <div className="mb-8 p-4 rounded-lg flex items-center justify-between bg-bg-tertiary">
                <div className="flex items-center">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center mr-3 bg-accent-primary">
                        <span className="text-white text-sm">?</span>
                    </div>
                    <span className="text-sm text-text-primary">Need help to understand the details?</span>
                </div>
                <Link href="#" className="text-sm link-accent hover:cursor-pointer">Learn more</Link>
            </div>

            {/* Why invest section */}
            <div className="mb-8">
                <h2 className="text-xl font-bold mb-6 text-text-primary">Why invest in this property?</h2>
                <div className="grid grid-cols-2 gap-8">
                    <div>
                        <h3 className="font-semibold mb-2 text-text-primary">Modern Urban Living</h3>
                        <p className="text-sm mb-4 text-text-secondary">
                            J One Tower in Business Bay offers stylish, fully furnished apartments with smart layouts and premium finishes, ideal for young professionals.
                        </p>
                        <h3 className="font-semibold mb-2 text-text-primary">Excellent Facilities</h3>
                        <p className="text-sm mb-4 text-text-secondary">
                            Residents enjoy access to a rooftop infinity pool, a fully equipped gym, spa with sauna and steam rooms, children's play areas, and 24/7 security coverage.
                        </p>
                        <h3 className="font-semibold mb-2 text-text-primary">Below Market Price</h3>
                        <p className="text-sm text-text-secondary">
                            Priced at AED 1,450,000 approximately 22.8% below the estimated AED 1,874,563 valuation by third party company, offering a strong entry point.
                        </p>
                    </div>
                    <div>
                        <h3 className="font-semibold mb-2 text-text-primary">Strong Rental Appeal</h3>
                        <p className="text-sm mb-4 text-text-secondary">
                            This flat-floor unit with excellent community and partial lake views is well-positioned for immediate occupancy, appealing to long-term tenants.
                        </p>
                        <h3 className="font-semibold mb-2 text-text-primary">Attractive Investment Returns</h3>
                        <p className="text-sm mb-4 text-text-secondary">
                            With a projected rental yield of 8.07% and an estimated average annual net rental returns of 5.22%, and an annualised ROI of 13.86% over five years.
                        </p>
                        <h3 className="font-semibold mb-2 text-text-primary">Prime Location</h3>
                        <p className="text-sm text-text-secondary">
                            Strategically located in Business Bay with easy access to Downtown Dubai, Dubai Mall, and metro stations, ensuring high rental demand and capital appreciation.
                        </p>
                    </div>
                </div>
            </div>

            {/* Investment Breakdown */}
            <div className="mb-8">
                <h2 className="text-xl font-bold mb-4 text-text-primary">Investment Breakdown</h2>
                <div className="grid grid-cols-4 gap-6">
                    <div>
                        <div className="text-sm mb-1 text-text-secondary">Property price</div>
                        <div className="font-bold text-text-primary">{formatCurrency(property.investmentBreakdown.propertyPrice)}</div>
                    </div>
                    <div>
                        <div className="text-sm mb-1 text-text-secondary">Purchase cost</div>
                        <div className="font-bold text-text-primary">{formatCurrency(property.investmentBreakdown.purchaseCost)}</div>
                    </div>
                    <div>
                        <div className="text-sm mb-1 text-text-secondary">Transaction cost</div>
                        <div className="font-bold text-text-primary">{formatCurrency(property.investmentBreakdown.transactionCost)}</div>
                    </div>
                    <div>
                        <div className="text-sm mb-1 text-text-secondary">Running cost</div>
                        <div className="font-bold text-text-primary">{formatCurrency(property.investmentBreakdown.runningCost)}</div>
                    </div>
                </div>
            </div>

            {/* Description */}
            <div className="mb-8">
                <h2 className="text-xl font-bold mb-4 text-text-primary">Description</h2>
                <p className="leading-relaxed mb-4 text-text-secondary">
                    {property.description.details}
                </p>
                {property.description.features?.length ? (
                    <ul className="list-disc pl-5 text-sm text-text-secondary mb-2">
                        {property.description.features.map((f, i) => (
                            <li key={i}>{f}</li>
                        ))}
                    </ul>
                ) : null}
                <button className="text-sm link-accent hover:cursor-pointer">Show More</button>
            </div>

            {/* What's In */}
            <div className="mb-8">
                <h2 className="text-xl font-bold mb-4 text-text-primary">What's In</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {Object.entries(property.features).map(([name, count]) => (
                        <div key={name} className="card flex items-center">
                            <div className="w-8 h-8 rounded mr-3 flex items-center justify-center bg-bg-secondary">
                                {getFeatureIcon(name)}
                            </div>
                            <span className="text-sm text-text-primary">{count} {name}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}