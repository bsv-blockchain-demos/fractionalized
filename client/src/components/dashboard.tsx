import { Link } from 'react-router-dom';
import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthContext } from '@/context/walletContext';
import { Spinner } from "./spinner";
import { PropertyImage } from './properties/PropertyImage';
import SellingListings from "./dashboard/SellingListings";
import MarketListings, { type MarketListingItem } from "./dashboard/MarketListings";
import PortfolioStats from "./dashboard/PortfolioStats";
import { useCancelListing } from '@/hooks/useCancelListing';
import { useMyListings, useMyShares, useMySelling } from '@/hooks/queries/useMyPortfolio';
import { usePropertiesByIds, type PropertyDetail } from '@/hooks/queries/useProperties';
import { useQueryErrorToast } from '@/hooks/queries/useQueryErrorToast';
import { qk } from '@/lib/queryKeys';

export function Dashboard() {
  const { userPubKey, ensureWallet } = useAuthContext();
  const { cancelListing, cancellingId } = useCancelListing();
  const queryClient = useQueryClient();

  useEffect(() => { ensureWallet(true); }, [ensureWallet]);

  const sharesQuery = useMyShares();
  const listingsQuery = useMyListings();
  const sellingQuery = useMySelling();
  useQueryErrorToast(sharesQuery.isError, "Failed to load your investments", "my-shares-error");
  useQueryErrorToast(listingsQuery.isError, "Failed to load your listings", "my-listings-error");
  useQueryErrorToast(sellingQuery.isError, "Failed to load your selling properties", "my-selling-error");

  const myShares = useMemo(() => sharesQuery.data ?? [], [sharesQuery.data]);
  const myListings = listingsQuery.data ?? [];
  const selling = sellingQuery.data ?? [];

  // One query per id — shared with the detail page and the sell modal, so the old
  // per-share loop of identical requests collapses.
  const propertyQueries = usePropertiesByIds(myShares.map((s) => s.propertyId));
  const investedProperties = useMemo(
    () => myShares
      .map((s, i) => ({ property: propertyQueries[i]?.data as PropertyDetail | undefined, percent: s.amount }))
      .filter((c): c is { property: PropertyDetail; percent: number } => !!c.property),
    [myShares, propertyQueries],
  );
  const loadingInvestments = sharesQuery.isLoading || propertyQueries.some((q) => q.isLoading);

  const handleCancelListing = (item: MarketListingItem) => {
    cancelListing(item).then((ok) => {
      if (ok && userPubKey) {
        queryClient.invalidateQueries({ queryKey: qk.myListings(userPubKey) });
        // Cancel reclaims the share into a new shares doc, so this list is stale too.
        queryClient.invalidateQueries({ queryKey: qk.myShares(userPubKey) });
      }
    });
  };

  const parsePercent = (s: string) => {
    const n = parseFloat(String(s).replace("%", ""));
    return isNaN(n) ? 0 : n;
  };

  const formatCurrency = (amount: number) => `USD ${amount.toLocaleString()}`;

  // Portfolio stats
  const stats = useMemo(() => {
    const totalInvestedUSD = investedProperties.reduce((sum, ip) => sum + (ip.property.priceUSD * ip.percent) / 100, 0);
    const expectedYearlyIncomeUSD = investedProperties.reduce((sum, ip) => {
      const annualised = parsePercent(ip.property.annualisedReturn) / 100;
      const invested = (ip.property.priceUSD * ip.percent) / 100;
      return sum + invested * annualised;
    }, 0);
    const avgGrossYield = investedProperties.length
      ? investedProperties.reduce((sum, ip) => sum + parsePercent(ip.property.grossYield), 0) / investedProperties.length
      : 0;
    const positions = investedProperties.length;
    return { totalInvestedUSD, expectedYearlyIncomeUSD, avgGrossYield, positions };
  }, [investedProperties]);

  return (
    <div className="container mx-auto px-4 py-6">
      {/* Your Investments */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold text-text-primary">Your Investments</h2>
          <Link to="/properties" className="text-sm link-accent hover:cursor-pointer">
            Explore more properties
          </Link>
        </div>
        {loadingInvestments ? (
          <div className="p-6 rounded-lg bg-bg-tertiary border border-border-subtle text-text-secondary">
            <div className="flex items-center gap-3">
              <Spinner size={20} />
              <span>Loading your investments...</span>
            </div>
          </div>
        ) : investedProperties.length === 0 ? (
          <div className="p-6 rounded-lg bg-bg-tertiary border border-border-subtle text-text-secondary">
            You don’t have any investments yet. Browse properties to get started.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {investedProperties.map(({ property, percent }) => (
              <Link key={String(property._id)} to={`/properties/${property._id}`} className="block">
                <div className="card-glass overflow-hidden transition-all group">
                  {/* Header / Image placeholder */}
                  <div className="relative h-40 bg-gradient-to-br from-accent-primary to-accent-hover">
                    <div className="absolute top-3 left-3 badge-dark text-xs">{percent}% owned</div>
                    <div className="absolute top-3 right-3 badge-success text-xs">{property.status.toUpperCase()}</div>
                    <PropertyImage images={property.images} alt={property.title}>
                      <div className="w-full h-full flex items-center justify-center opacity-60">
                        <div className="text-white text-sm">Property Image</div>
                      </div>
                    </PropertyImage>
                  </div>

                  {/* Body */}
                  <div className="p-4">
                    <p className="text-xs text-text-secondary mb-1">{property.location}</p>
                    <h3 className="text-lg font-semibold text-text-primary mb-3 line-clamp-2">{property.title}</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-text-secondary">Your stake</span>
                        <span className="font-medium text-text-primary">{percent}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-secondary">Invested</span>
                        <span className="font-medium text-text-primary">{formatCurrency((property.priceUSD * percent) / 100)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-secondary">Expected yearly income</span>
                        <span className="font-medium" style={{ color: "var(--success)" }}>
                          {(() => {
                            const rate = parsePercent(property.annualisedReturn) / 100;
                            const invested = (property.priceUSD * percent) / 100;
                            return formatCurrency(invested * rate);
                          })()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-secondary">Gross yield</span>
                        <span className="font-medium" style={{ color: "var(--info)" }}>{property.grossYield}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="section-divider" />

      {/* Selling listings */}
      <SellingListings selling={selling} />

      <div className="section-divider" />

      {/* Your Market Listings */}
      <MarketListings
        loading={listingsQuery.isLoading}
        items={myListings}
        onCancel={handleCancelListing}
        cancellingId={cancellingId}
      />

      <div className="section-divider" />

      {/* Portfolio stats */}
      <PortfolioStats stats={stats} />
    </div>
  );
}