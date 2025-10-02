"use client";

import { useMemo } from "react";
import { useAuthContext } from "../context/walletContext";
import { Spinner } from "./spinner";

export type PurchaseItem = {
  id: string; // market item id
  name: string;
  location: string;
  sellAmount: number; // percent
  pricePerShare: number; // AED per 1%
  propertyId: string;
  sellerId: string;
};

export function MarketPurchaseModal({
  open,
  loading,
  item,
  onClose,
  onBuy,
}: {
  open: boolean;
  loading: boolean;
  item: PurchaseItem | null;
  onClose: () => void;
  onBuy: (payload: { marketItemId: string; buyerId: string; }) => void;
}) {
  const { userPubKey } = useAuthContext();

  const totalPrice = useMemo(() => {
    if (!item) return 0;
    return Number(item.sellAmount) * Number(item.pricePerShare || 0);
  }, [item]);

  if (!open || !item) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={() => !loading && onClose()} />

      {/* Modal panel */}
      <div className="relative z-10 w-full max-w-md mx-4 card-glass p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-text-primary">Confirm purchase</h3>
          <button
            onClick={onClose}
            disabled={loading}
            className="text-text-secondary hover:text-text-primary disabled:opacity-60"
          >
            ✕
          </button>
        </div>

        {/* Property summary */}
        <div className="bg-bg-tertiary border border-border-subtle rounded-lg p-3 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-text-primary line-clamp-1">{item.name}</div>
              <div className="text-xs text-text-secondary">{item.location}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-text-secondary">Amount</div>
              <div className="font-medium text-text-primary">{item.sellAmount}%</div>
            </div>
          </div>
        </div>

        {/* Totals */}
        <div className="space-y-2 text-sm mb-4">
          <div className="flex justify-between">
            <span className="text-text-secondary">Price per 1%</span>
            <span className="text-text-primary font-medium">AED {item.pricePerShare.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-secondary">Total price</span>
            <span className="text-text-primary font-semibold">AED {totalPrice.toLocaleString()}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-3 py-2 rounded-lg border border-border-subtle bg-bg-secondary text-text-primary disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={loading || !userPubKey}
            onClick={() => {
              if (!userPubKey) return;
              onBuy({ marketItemId: item.id, buyerId: userPubKey });
            }}
            className="px-3 py-2 rounded-lg bg-accent-primary hover:bg-accent-primary/90 text-white btn-glow disabled:opacity-60"
          >
            {loading ? "Processing..." : "Buy"}
          </button>
        </div>

        {loading && (
          <div className="absolute inset-0 rounded-xl bg-bg-primary/70 backdrop-blur-sm flex items-center justify-center">
            <div className="flex items-center gap-3 text-text-primary">
              <Spinner size={20} />
              <span>Processing your purchase...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
