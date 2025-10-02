"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { type Property } from "../lib/dummydata";
import { useAuthContext } from "../context/walletContext";
import { Spinner } from "./spinner";
import { toast } from "react-hot-toast";

export function Dashboard() {
  // User shares mapped to properties
  const [investedCards, setInvestedCards] = useState<
    { property: Property; percent: number }[]
  >([]);
  const [selling, setSelling] = useState<Property[]>([]);

  const [loadingInvestments, setLoadingInvestments] = useState<boolean>(false);
  const [loadingSelling, setLoadingSelling] = useState<boolean>(false);
  const { userWallet, userPubKey, initializeWallet } = useAuthContext();

  useEffect(() => {
    const fetchInvestedProperties = async () => {
      setLoadingInvestments(true);
      try {
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

        // Get owned shares
        const response = await fetch("/api/my-shares", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: userPubKey }),
        });
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        const data = await response.json();
        const shares: Array<{
          _id: string;
          propertyId: string;
          amount: number; // percent
        }> = (data?.shares || []).map((s: any) => ({
          _id: String(s?._id ?? ""),
          propertyId: String(s?.propertyId ?? ""),
          amount: Number(s?.amount ?? 0),
        }));

        if (!shares.length) {
          setInvestedCards([]);
          return;
        }

        // Fetch property details for each share
        const props = await Promise.all(
          shares.map(async (s) => {
            const res = await fetch(`/api/properties/${s.propertyId}`);
            if (!res.ok) {
              throw new Error(`Property HTTP ${res.status}`);
            }
            const pd = await res.json();
            return { property: pd?.item as Property, percent: s.amount };
          })
        );

        // Filter out any failed/undefined items just in case
        const valid = props.filter(
          (p): p is { property: Property; percent: number } => !!p?.property
        );
        setInvestedCards(valid);
      } catch (e: any) {
        console.error(e);
        toast.error("Failed to load your investments");
      } finally {
        setLoadingInvestments(false);
      }
    };
    fetchInvestedProperties();
    // Re-run if the user identity changes
  }, [userWallet, userPubKey, initializeWallet]);

  // Fetch properties the user is selling
  useEffect(() => {
    const fetchSellingProperties = async () => {
      setLoadingSelling(true);
      try {
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

        // Get selling properties
        const response = await fetch("/api/my-selling", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: userPubKey }),
        });
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        const data = await response.json();
        const props: Property[] = data?.items || [];

        // Filter out any failed/undefined items just in case
        const valid = props.filter(
          (p): p is Property => !!p
        );
        setSelling(valid);
      } catch (e: any) {
        console.error(e);
        toast.error("Failed to load your selling properties");
      } finally {
        setLoadingSelling(false);
      }
    };
    fetchSellingProperties();
    // Re-run if the user identity changes
  }, [userWallet, userPubKey, initializeWallet]);

  const investedProperties = investedCards;

  const parsePercent = (s: string) => {
    const n = parseFloat(String(s).replace("%", ""));
    return isNaN(n) ? 0 : n;
  };

  const formatCurrency = (amount: number) => `AED ${amount.toLocaleString()}`;

  // Portfolio stats
  const stats = useMemo(() => {
    const totalInvestedAED = investedProperties.reduce((sum, ip) => sum + (ip.property.priceAED * ip.percent) / 100, 0);
    const expectedYearlyIncomeAED = investedProperties.reduce((sum, ip) => {
      const annualised = parsePercent(ip.property.annualisedReturn) / 100;
      const invested = (ip.property.priceAED * ip.percent) / 100;
      return sum + invested * annualised;
    }, 0);
    const avgGrossYield = investedProperties.length
      ? investedProperties.reduce((sum, ip) => sum + parsePercent(ip.property.grossYield), 0) / investedProperties.length
      : 0;
    const positions = investedProperties.length;
    return { totalInvestedAED, expectedYearlyIncomeAED, avgGrossYield, positions };
  }, [investedProperties]);

  return (
    <div className="container mx-auto px-4 py-6">
      {/* Your Investments */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold text-text-primary">Your Investments</h2>
          <Link href="/properties" className="text-sm link-accent hover:cursor-pointer">
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
              <Link key={property._id} href={`/properties/${property._id}`} className="block">
                <div className="card-glass overflow-hidden transition-all group">
                  {/* Header / Image placeholder */}
                  <div className="relative h-40 bg-gradient-to-br from-accent-primary to-accent-hover">
                    <div className="absolute top-3 left-3 badge-dark text-xs">{percent}% owned</div>
                    <div className="absolute top-3 right-3 badge-success text-xs">{property.status.toUpperCase()}</div>
                    <div className="w-full h-full flex items-center justify-center opacity-60">
                      <div className="text-white text-sm">Property Image</div>
                    </div>
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
                        <span className="font-medium text-text-primary">{formatCurrency((property.priceAED * percent) / 100)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-secondary">Expected yearly income</span>
                        <span className="font-medium" style={{ color: "var(--success)" }}>
                          {(() => {
                            const rate = parsePercent(property.annualisedReturn) / 100;
                            const invested = (property.priceAED * percent) / 100;
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

      {/* Selling listings (placeholder) */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold text-text-primary">Your Listings (Selling)</h2>
          <button type="button" className="px-3 py-1.5 rounded-lg border border-border-subtle bg-bg-secondary text-sm text-text-primary btn-glow">
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
                  <div className="text-sm text-text-primary">Asking: {formatCurrency(property.priceAED)}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="section-divider" />

      {/* Portfolio stats */}
      <section className="mb-4">
        <div className="card-elevated p-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 text-center">
            <div className="group/stat hover:scale-105 transition-transform duration-300">
              <div className="text-2xl font-bold mb-1 text-accent-primary group-hover/stat:text-accent-subtle transition-colors duration-300">
                {formatCurrency(stats.totalInvestedAED)}
              </div>
              <div className="text-text-secondary">Total Invested</div>
            </div>
            <div className="group/stat hover:scale-105 transition-transform duration-300">
              <div className="text-2xl font-bold mb-1" style={{ color: "var(--success)" }}>
                {formatCurrency(stats.expectedYearlyIncomeAED)}
              </div>
              <div className="text-text-secondary">Expected Yearly Income</div>
            </div>
            <div className="group/stat hover:scale-105 transition-transform duration-300">
              <div className="text-2xl font-bold mb-1" style={{ color: "var(--info)" }}>
                {stats.avgGrossYield.toFixed(2)}%
              </div>
              <div className="text-text-secondary">Avg Gross Yield</div>
            </div>
            <div className="group/stat hover:scale-105 transition-transform duration-300">
              <div className="text-2xl font-bold mb-1 text-warning group-hover/stat:text-amber-400 transition-colors duration-300">
                {stats.positions}
              </div>
              <div className="text-text-secondary">Positions</div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}