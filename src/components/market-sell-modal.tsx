"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuthContext } from "../context/walletContext";
import { Spinner } from "./spinner";
import toast from "react-hot-toast";

type OwnedShare = {
  _id: string;
  propertyId: string;
  amount: number; // percent
  transferTxid: string;
  propertyTitle?: string;
};

type Property = {
  _id: string;
  title: string;
  location: string;
  priceUSD: number;
  tokenTxid: string;
};

export function MarketSellModal({ open, loading, success, onClose, onListed }: {
  open: boolean;
  loading: boolean;
  success: boolean;
  onClose: () => void;
  onListed: (payload: {
    shareId: string;
    propertyId: string;
    pricePerShare: number;
    transferTxid: string;
    tokenTxid: string;
  }) => void;
}) {
  const { userWallet, userPubKey, initializeWallet } = useAuthContext();
  const [loadingData, setLoadingData] = useState(false);
  const [shares, setShares] = useState<OwnedShare[]>([]);
  const [selectedShareId, setSelectedShareId] = useState<string>("");
  const [property, setProperty] = useState<Property | null>(null);
  const [pricePerShare, setPricePerShare] = useState<number>(0);
  const selectedShare = useMemo(
    () => shares.find(s => s._id === selectedShareId) || null,
    [shares, selectedShareId]
  );

  // Load user's shares when modal opens
  useEffect(() => {
    if (!open) return;
    const run = async () => {
      setLoadingData(true);
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
        const res = await fetch("/api/my-shares", { method: "POST" });
        const data = await res.json();
        const mapped: OwnedShare[] = (data?.shares || []).map((s: any) => ({
          _id: String(s?._id ?? ""),
          propertyId: String(s?.propertyId ?? ""),
          amount: Number(s?.amount ?? 0),
          transferTxid: String(s?.transferTxid ?? ""),
          propertyTitle: String(s?.propertyTitle ?? ""),
        }));
        setShares(mapped);
        if (mapped.length) setSelectedShareId(mapped[0]._id);
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingData(false);
      }
    };
    run();
  }, [open, userWallet, userPubKey, initializeWallet]);

  // Load property details and set default price when share changes
  useEffect(() => {
    const loadProperty = async () => {
      if (!selectedShare) {
        setProperty(null);
        return;
      }
      try {
        const res = await fetch(`/api/properties/${selectedShare.propertyId}`);
        if (!res.ok) throw new Error("Property fetch failed");
        const { item } = await res.json();
        const prop: Property = {
          _id: String(item?._id ?? selectedShare.propertyId),
          title: String(item?.title ?? "Property"),
          location: String(item?.location ?? ""),
          priceUSD: Number(item?.priceUSD ?? 0),
          tokenTxid: String(item?.txids?.tokenTxid ?? ""),
        };
        setProperty(prop);
        // First estimate: property price / 100 (price per % share)
        const estimate = Math.max(0, Math.round((prop.priceUSD / 100) * 100) / 100);
        setPricePerShare(estimate);
      } catch (e) {
        console.error(e);
        setProperty(null);
        setPricePerShare(0);
      }
    };
    loadProperty();
  }, [selectedShare]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={() => !loading && !success && onClose()} />

      {/* Modal panel */}
      <div className="relative z-10 w-full max-w-lg mx-4 bg-bg-secondary border border-border-subtle rounded-xl p-5 shadow-xl">
        {/* Success state */}
        {success && (
          <div className="text-center py-8">
            <div className="text-5xl mb-4 text-green-500">✓</div>
            <h3 className="text-xl font-bold text-text-primary mb-2">Listing Created!</h3>
            <p className="text-text-secondary mb-6">
              Your share is now listed on the marketplace
            </p>
            <div className="flex items-center justify-center gap-3">
              <a
                href="/marketplace"
                className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-hover transition-colors btn-glow"
              >
                View Marketplace
              </a>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-border-subtle bg-bg-primary text-text-primary hover:bg-bg-secondary transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* Form state */}
        {!success && (
          <>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-text-primary">Sell share</h3>
              <button onClick={onClose} className="text-text-secondary hover:text-text-primary" disabled={loading}>✕</button>
            </div>

        {loadingData ? (
          <div className="text-sm text-text-secondary">Loading your shares...</div>
        ) : shares.length === 0 ? (
          <div className="text-sm text-text-secondary">No shares available to sell.</div>
        ) : (
          <div className="space-y-4">
            {/* Share selection */}
            <div>
              <label className="block text-xs text-text-secondary mb-1">Select share</label>
              <select
                value={selectedShareId}
                onChange={(e) => setSelectedShareId(e.target.value)}
                disabled={loading}
                className="w-full rounded-lg border border-border-subtle bg-bg-primary text-text-primary px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-primary/30 disabled:opacity-60"
              >
                {shares.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.propertyTitle || s._id.slice(-6)} - {s.amount}%
                  </option>
                ))}
              </select>
            </div>

            {/* Property context */}
            {property && (
              <div className="bg-bg-tertiary border border-border-subtle rounded-lg p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-text-primary line-clamp-1">{property.title}</div>
                    <div className="text-xs text-text-secondary">{property.location}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-text-secondary">Property price</div>
                    <div className="font-medium text-text-primary">USD {property.priceUSD.toLocaleString()}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Price per share */}
            <div>
              <label className="block text-xs text-text-secondary mb-1">Price per 1% share (USD)</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={pricePerShare}
                onChange={(e) => setPricePerShare(Number(e.target.value))}
                disabled={loading}
                className="w-full rounded-lg border border-border-subtle bg-bg-primary text-text-primary px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-primary/30 disabled:opacity-60"
              />
              <p className="text-xs text-text-secondary mt-1">Estimate based on property price ÷ 100.</p>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                disabled={loading}
                className="px-3 py-2 rounded-lg border border-border-subtle bg-bg-secondary text-text-primary disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!selectedShare) return;
                  if (!property) return;
                  const payload = {
                    shareId: selectedShare._id,
                    propertyId: selectedShare.propertyId,
                    pricePerShare: Number(pricePerShare) || 0,
                    transferTxid: selectedShare.transferTxid,
                    tokenTxid: property.tokenTxid,
                  };
                  onListed(payload);
                }}
                disabled={loading}
                className="px-3 py-2 rounded-lg bg-accent-primary hover:bg-accent-primary/90 text-white btn-glow disabled:opacity-60"
              >
                {loading ? "Processing..." : "List for sale"}
              </button>
            </div>
          </div>
        )}

            {loading && (
              <div className="absolute inset-0 rounded-xl bg-bg-primary/70 backdrop-blur-sm flex items-center justify-center">
                <div className="flex items-center gap-3 text-text-primary">
                  <Spinner size={20} />
                  <span>Processing your listing...</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
