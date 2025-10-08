"use client";

import { dummyProperties } from '../lib/dummydata';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Modal } from './modal';
import { useFeatureDisplay } from '../hooks/useFeatureDisplay';
import { toast } from 'react-hot-toast';
import { useAuthContext } from '../context/walletContext';

export function PropertyDetails({ propertyId }: { propertyId: string }) {
    const [property, setProperty] = useState<any | null>(() => dummyProperties.find(p => p._id.toString() === propertyId) || null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    const { userWallet, initializeWallet, userPubKey } = useAuthContext();

    useEffect(() => {
        async function fetchProperty() {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch(`/api/properties/${propertyId}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();

                const item = data?.item;
                if (item) {
                    setProperty(item);
                } else {
                    setError("Property not found");
                }
            } catch (e: any) {
                setError("Failed to load property details");
            } finally {
                setLoading(false);
            }
        }
        fetchProperty();
    }, [propertyId]);
    
    const handleContinueInvest = async () => {
        const amount = selectedPercent === 'custom' ? sanitizedCustom : selectedPercent;

        if (!userWallet) {
            try {
                await initializeWallet();
            } catch (e) {
                console.error('Failed to initialize wallet:', e);
                toast.error('Failed to connect wallet', {
                    duration: 5000,
                    position: 'top-center',
                    id: 'wallet-connect-error',
                });
                return;
            }
        }

        const response = await fetch(`/api/share-purchase`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                propertyId,
                investorId: userPubKey,
                amount: Number(amount),
            }),
        });
        const data = await response.json();
        if (data.error) {
            console.error(data.error);
            return;
        }
        console.log(data);
        toast.success("Share purchased successfully");
    };

    const formatCurrency = (amount: number) => {
        return `AED ${amount.toLocaleString()}`;
    };

    // Feature display (icons + pluralized labels)
    const displayFeatures = useFeatureDisplay(property?.features ?? []);

    // Invest modal state (percent-only)
    const [isInvestOpen, setInvestOpen] = useState(false);
    const presets = useMemo(() => [1, 5, 10, 25, 50], []);
    const [selectedPercent, setSelectedPercent] = useState<number | 'custom'>(1);
    const [customPercent, setCustomPercent] = useState<string>('');

    if (loading && !property) {
        return <div className="container mx-auto px-4 py-6 text-text-secondary">Loading property...</div>;
    }
    if (!property) {
        return <div className="container mx-auto px-4 py-6 text-text-secondary">Property not found</div>;
    }

    // Derived numbers
    const sellerIdentifier =  (property as any).seller || null;
    const isSeller = !!sellerIdentifier && !!userPubKey && String(sellerIdentifier).toLowerCase() === String(userPubKey).toLowerCase();

    const priceAED = property.priceAED;
    // sanitize custom percent: integers only 1..100
    const sanitizedCustom = (() => {
        const n = Math.floor(Number(customPercent || 0));
        if (!isFinite(n)) return 0;
        return Math.max(1, Math.min(100, n));
    })();
    const percentFromState = selectedPercent === 'custom' ? sanitizedCustom : selectedPercent;
    const effectivePercent = percentFromState;
    const investmentAmountAED = (priceAED * (effectivePercent || 0)) / 100;
    const annualisedRate = (() => {
        const n = parseFloat(String(property.annualisedReturn).replace('%', ''));
        return isNaN(n) ? 0 : n / 100;
    })();
    const expectedAnnualReturnAED = investmentAmountAED * annualisedRate;

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
                        <div className="flex items-center gap-4 justify-end">
                            <span className="px-3 py-1 rounded text-sm font-medium badge-success">{property.status.toUpperCase()}</span>
                            <span className="text-sm text-text-secondary">
                                {property.investors} investors
                            </span>
                            {!isSeller && (
                                <button
                                    type="button"
                                    onClick={() => setInvestOpen(true)}
                                    className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-hover hover:cursor-pointer transition-colors text-sm btn-glow border border-transparent"
                                >
                                    Invest
                                </button>
                            )}
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
                {property.whyInvest && property.whyInvest.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {property.whyInvest.map((w: { title?: string; text?: string }, i: number) => (
                            <div key={i}>
                                {w.title ? (
                                    <h3 className="font-semibold mb-2 text-text-primary">{w.title}</h3>
                                ) : null}
                                {w.text ? (
                                    <p className="text-sm mb-4 text-text-secondary">{w.text}</p>
                                ) : null}
                            </div>
                        ))}
                    </div>
                ) : (
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
                )}
            </div>

            <div className="section-divider" />

            {/* Investment Breakdown */}
            <div className="mb-8">
                <h2 className="text-xl font-bold mb-4 text-text-primary">Investment Breakdown</h2>
                <div className="grid grid-cols-4 gap-6">
                    <div>
                        <div className="text-sm mb-1 text-text-secondary">Property price</div>
                        <div className="font-bold text-text-primary">{formatCurrency(property.priceAED)}</div>
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

            <div className="section-divider" />

            {/* Description */}
            <div className="mb-8">
                <h2 className="text-xl font-bold mb-4 text-text-primary">Description</h2>
                <p className="leading-relaxed mb-4 text-text-secondary">
                    {property.description.details}
                </p>
                {property.description.features?.length ? (
                    <ul className="list-disc pl-5 text-sm text-text-secondary mb-2">
                        {property.description.features.map((feature: string, index: number) => (
                            <li key={index}>{feature}</li>
                        ))}
                    </ul>
                ) : null}
                <button className="text-sm link-accent hover:cursor-pointer">Show More</button>
            </div>

            {/* What's In */}
            <div className="mb-8">
                <h2 className="text-xl font-bold mb-4 text-text-primary">What's In</h2>
                <div className="flex flex-wrap gap-2">
                    {displayFeatures.map((f: { key: string; icon: any; count: number; label: string }) => (
                        <span
                            key={f.key}
                            className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border-subtle bg-bg-secondary text-sm text-text-primary"
                        >
                            <span>{f.icon}</span>
                            <span>
                                {f.count} {f.label}
                            </span>
                        </span>
                    ))}
                </div>
            </div>

            {/* Invest Modal */}
            <Modal isOpen={isInvestOpen} onClose={() => setInvestOpen(false)} title="Invest in this property">
                <div className="space-y-5">
                    <div className="text-xs md:text-sm text-red-500">
                        This is a demo application. Investing actions shown here are not real.
                    </div>
                    {/* Percent selection */}
                    <div>
                        <div className="text-sm text-text-secondary mb-2">Choose your share (%)</div>
                        <div className="grid grid-cols-3 gap-2">
                            {presets.map((p) => (
                                <button
                                    key={p}
                                    type="button"
                                    onClick={() => setSelectedPercent(p)}
                                    className={[
                                        'px-3 py-2 rounded border text-sm hover:cursor-pointer',
                                        selectedPercent === p ? 'bg-accent-primary text-white border-transparent' : 'bg-bg-secondary text-text-primary border-border-subtle'
                                    ].join(' ')}
                                >
                                    {p}%
                                </button>
                            ))}
                            <div className="flex items-center gap-2 col-span-3">
                                <input
                                    type="number"
                                    min={1}
                                    max={100}
                                    step={1}
                                    value={selectedPercent === 'custom' ? sanitizedCustom : ''}
                                    onChange={(e) => {
                                        // accept only integers 1..100
                                        const raw = e.target.value.replace(/[^0-9]/g, '');
                                        const n = Math.max(1, Math.min(100, Number(raw || 0)));
                                        setCustomPercent(String(n));
                                        setSelectedPercent('custom');
                                    }}
                                    placeholder="Custom % (1-100)"
                                    className="flex-1 px-3 py-2 rounded border border-border-subtle bg-bg-secondary text-text-primary"
                                />
                                <span className="text-text-secondary">%</span>
                            </div>
                        </div>
                    </div>

                    {/* Preview */}
                    <div className="p-3 rounded-lg bg-bg-tertiary border border-border-subtle text-sm">
                        <div className="mb-1">
                            You're investing <span className="font-semibold text-text-primary">{formatCurrency(investmentAmountAED)}</span>
                            {` = `}
                            <span className="font-semibold text-text-primary">{(effectivePercent || 0).toFixed(0)}%</span> ownership of this property.
                        </div>
                        <div>
                            Expected annualized return: <span className="font-semibold" style={{ color: 'var(--success)' }}>{formatCurrency(expectedAnnualReturnAED)}</span>
                        </div>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                        <div className="text-sm text-text-secondary">
                            Price: <span className="font-medium text-text-primary">{formatCurrency(priceAED)}</span>
                        </div>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => setInvestOpen(false)}
                                className="px-4 py-2 rounded-lg border border-border-subtle bg-bg-secondary text-text-primary text-sm hover:cursor-pointer btn-glow"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={(effectivePercent || 0) < 1 || (effectivePercent || 0) > 100}
                                className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-hover hover:cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm btn-glow border border-transparent"
                                onClick={handleContinueInvest}
                            >
                                Continue
                            </button>
                        </div>
                    </div>
                </div>
            </Modal>
        </div>
    );
}