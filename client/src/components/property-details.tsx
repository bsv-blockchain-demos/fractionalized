import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { InvestModal } from './invest-modal';
import { useFeatureDisplay } from '@/hooks/useFeatureDisplay';
import { toast } from 'react-hot-toast';
import { useAuthContext } from '@/context/walletContext';
import { internalizeToBasket } from '@shared/bsv/internalizeToBasket';
import { decodeBeef } from '@shared/bsv/beefEncoding';
import { logger } from '@shared/logger';
import { useProperty } from '@/hooks/queries/useProperties';
import { qk } from '@/lib/queryKeys';
import { PropertyImage } from './properties/PropertyImage';
import { apiFetchStepUp } from '@/lib/apiFetchStepUp';
import { AUTH_PROOF_PURPOSE } from '@shared/authProofPurposes';

export function PropertyDetails({ propertyId }: { propertyId: string }) {
    const { userWallet, ensureWallet, userPubKey } = useAuthContext();
    const queryClient = useQueryClient();

    const { data: property, isPending: loading } = useProperty(propertyId);

    useEffect(() => { ensureWallet(true); }, [ensureWallet]);

    const handleContinueInvest = async (amount: number) => {
        setInvestLoading(true);

        try {
            const pk = await ensureWallet();
            if (!pk) {
                setInvestLoading(false);
                return;
            }

            // Send purchase request to API
            const response = await apiFetchStepUp(
                `/api/share-purchase`,
                userWallet!,
                AUTH_PROOF_PURPOSE.sharePurchase,
                {
                    propertyId,
                    investorId: pk,
                    amount: Number(amount),
                },
            );
            const data = await response.json();

            // Handle API errors
            if (data.error) {
                logger.error(data.error);
                toast.error("Failed to purchase share");
                setInvestLoading(false);
                return;
            }

            // Internalize the purchased share output into the investor's wallet basket
            if (data?.received) {
                try {
                    await internalizeToBasket(
                        userWallet!,
                        decodeBeef(data.received.atomicBeef),
                        [{
                            outputIndex: data.received.outputIndex,
                            keyId: data.received.keyId,
                            counterparty: data.received.counterparty,
                            tags: ['type:share'],
                        }],
                        "Receive purchased share",
                    );
                } catch (e) {
                    logger.warn("Failed to internalize purchased share into wallet basket:", e);
                }
            }

            // Availability, investor count and status all moved server-side.
            queryClient.invalidateQueries({ queryKey: qk.property(propertyId) });
            queryClient.invalidateQueries({ queryKey: qk.myShares(pk) });

            // Show success state
            setInvestSuccess(true);
            toast.success("Share purchased", { duration: 4000, position: "top-center", id: "invest-success" });
        } catch (e) {
            logger.error('Investment error:', e);
            toast.error('Failed to complete investment');
        } finally {
            setInvestLoading(false);
        }
    };

    const formatCurrency = (amount: number) => {
        return `USD ${amount.toLocaleString()}`;
    };

    // Feature display (icons + pluralized labels)
    const displayFeatures = useFeatureDisplay(property?.features);

    // Invest modal state
    const [isInvestOpen, setInvestOpen] = useState(false);
    const [investLoading, setInvestLoading] = useState(false);
    const [investSuccess, setInvestSuccess] = useState(false);

    if (loading && !property) {
        return <div className="container mx-auto px-4 py-6 text-text-secondary">Loading property...</div>;
    }
    if (!property) {
        return <div className="container mx-auto px-4 py-6 text-text-secondary">Property not found</div>;
    }

    // Derived numbers
    const sellerIdentifier = property.seller || null;
    const isSeller = !!sellerIdentifier && !!userPubKey && String(sellerIdentifier).toLowerCase() === String(userPubKey).toLowerCase();

    return (
        <div className="container mx-auto px-4 py-6">
            {/* Breadcrumb */}
            <nav className="text-sm mb-6 text-text-secondary">
                <Link to="/properties" className="link-accent hover:cursor-pointer">
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
                            {formatCurrency(property.priceUSD)}
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
                                    disabled={property.availablePercent != null && property.availablePercent <= 0}
                                    className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-hover hover:cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm btn-glow border border-transparent"
                                >
                                    {property.availablePercent != null && property.availablePercent <= 0 ? 'Fully Funded' : 'Invest'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className="relative h-72 mb-8 rounded-lg overflow-hidden bg-gradient-to-br from-accent-primary to-accent-hover">
                <PropertyImage images={property.images} alt={property.title}>
                    <div className="w-full h-full flex items-center justify-center opacity-60">
                        <div className="text-white text-sm">Property Image</div>
                    </div>
                </PropertyImage>
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
                <Link to="#" className="text-sm link-accent hover:cursor-pointer">Learn more</Link>
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
                    <p className="text-sm text-text-secondary">No additional investment notes.</p>
                )}
            </div>

            <div className="section-divider" />

            {/* Investment Breakdown */}
            <div className="mb-8">
                <h2 className="text-xl font-bold mb-4 text-text-primary">Investment Breakdown</h2>
                <div className="grid grid-cols-4 gap-6">
                    <div>
                        <div className="text-sm mb-1 text-text-secondary">Property price</div>
                        <div className="font-bold text-text-primary">{formatCurrency(property.priceUSD)}</div>
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
            {property.description && (
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
            )}

            {/* What's In */}
            <div className="mb-8">
                <h2 className="text-xl font-bold mb-4 text-text-primary">What&apos;s In</h2>
                <div className="flex flex-wrap gap-2">
                    {displayFeatures.map((f) => (
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
            <InvestModal
                open={isInvestOpen}
                loading={investLoading}
                success={investSuccess}
                property={property}
                onClose={() => {
                    setInvestOpen(false);
                    setInvestSuccess(false);
                }}
                onInvest={handleContinueInvest}
            />
        </div>
    );
}