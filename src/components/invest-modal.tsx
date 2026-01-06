"use client";

import { useMemo, useState } from "react";
import { Spinner } from "./spinner";

type InvestModalProps = {
  open: boolean;
  loading: boolean;
  success: boolean;
  property: {
    _id: string | { toString(): string };
    title: string;
    location: string;
    priceUSD: number;
    annualisedReturn: string;
    sell?: {
      percentToSell: number;
    };
    availablePercent?: number | null;
    totalSold?: number;
  } | null;
  onClose: () => void;
  onInvest: (amount: number) => void;
};

export function InvestModal({
  open,
  loading,
  success,
  property,
  onClose,
  onInvest,
}: InvestModalProps) {
  const presets = useMemo(() => [1, 5, 10, 25, 50], []);
  const [selectedPercent, setSelectedPercent] = useState<number | 'custom'>(1);
  const [customPercent, setCustomPercent] = useState<string>('');

  if (!open || !property) return null;

  const priceUSD = property.priceUSD;
  const totalSold = property.totalSold || 0;
  const percentToSell = property.sell?.percentToSell;
  const remainingPercent = property.availablePercent;

  // sanitize custom percent: integers only 1..maxAvailable (based on remaining shares)
  const maxAvailable = remainingPercent != null ? Math.floor(remainingPercent) : 100;
  const sanitizedCustom = (() => {
    const n = Math.floor(Number(customPercent || 0));
    if (!isFinite(n)) return 0;
    return Math.max(1, Math.min(maxAvailable, n));
  })();
  const percentFromState = selectedPercent === 'custom' ? sanitizedCustom : selectedPercent;
  const effectivePercent = percentFromState;
  const investmentAmountUSD = (priceUSD * (effectivePercent || 0)) / 100;
  const annualisedRate = (() => {
    const n = parseFloat(String(property.annualisedReturn).replace('%', ''));
    return isNaN(n) ? 0 : n / 100;
  })();
  const expectedAnnualReturnUSD = investmentAmountUSD * annualisedRate;

  const formatCurrency = (amount: number) => {
    return `USD ${amount.toLocaleString()}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={() => !loading && !success && onClose()} />

      {/* Modal panel */}
      <div className="relative z-10 w-full max-w-md mx-4 bg-bg-secondary border border-border-subtle rounded-xl shadow-xl">
        {/* Success state */}
        {success && (
          <div className="p-5">
            <div className="text-center py-8">
              <div className="text-5xl mb-4 text-green-500">✓</div>
              <h3 className="text-xl font-bold text-text-primary mb-2">Investment Successful!</h3>
              <p className="text-text-secondary mb-2">
                You now own {effectivePercent}% of {property.title}
              </p>
              <p className="text-sm text-text-muted mb-6">
                Expected annual return: <span className="font-semibold text-green-500">{formatCurrency(expectedAnnualReturnUSD)}</span>
              </p>
              <div className="flex items-center justify-center gap-3">
                <a
                  href="/dashboard"
                  className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-hover transition-colors btn-glow"
                >
                  View Dashboard
                </a>
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg border border-border-subtle bg-bg-primary text-text-primary hover:bg-bg-secondary transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Form state */}
        {!success && (
          <>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
              <h3 className="text-lg font-semibold text-text-primary">Invest in this property</h3>
              <button
                onClick={onClose}
                disabled={loading}
                className="text-text-secondary hover:text-text-primary disabled:opacity-60"
              >
                ✕
              </button>
            </div>

            <div className="px-5 py-4 space-y-5">
              <div className="text-xs md:text-sm text-red-500">
                This is a demo application. Investing actions shown here are not real.
              </div>

              {/* Available shares info */}
              {percentToSell != null && (
                <div className="p-3 rounded-lg bg-bg-tertiary border border-border-subtle text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-text-secondary">Available for purchase:</span>
                    <span className="font-semibold text-text-primary">
                      {remainingPercent != null ? remainingPercent.toFixed(2) : '0'}% of {percentToSell}%
                    </span>
                  </div>
                  {totalSold > 0 && (
                    <div className="mt-1 text-xs text-text-secondary">
                      ({totalSold.toFixed(2)}% already sold)
                    </div>
                  )}
                  {remainingPercent != null && remainingPercent <= 0 && (
                    <div className="mt-2 p-2 rounded bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-500">
                      This property is fully funded. No shares available for purchase.
                    </div>
                  )}
                </div>
              )}

              {/* Percent selection */}
              <div>
                <div className="text-sm text-text-secondary mb-2">Choose your share (%)</div>
                <div className="grid grid-cols-3 gap-2">
                  {presets
                    .filter(p => remainingPercent == null || p <= remainingPercent)
                    .map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setSelectedPercent(p)}
                        disabled={loading}
                        className={[
                          'px-3 py-2 rounded border text-sm hover:cursor-pointer disabled:opacity-60',
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
                      max={maxAvailable}
                      step={1}
                      value={selectedPercent === 'custom' ? sanitizedCustom : ''}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^0-9]/g, '');
                        const n = Math.max(1, Math.min(maxAvailable, Number(raw || 0)));
                        setCustomPercent(String(n));
                        setSelectedPercent('custom');
                      }}
                      disabled={loading}
                      placeholder={`Custom % (1-${maxAvailable})`}
                      className="flex-1 px-3 py-2 rounded border border-border-subtle bg-bg-secondary text-text-primary disabled:opacity-60"
                    />
                    <span className="text-text-secondary">%</span>
                  </div>
                </div>
              </div>

              {/* Preview */}
              <div className="p-3 rounded-lg bg-bg-tertiary border border-border-subtle text-sm">
                <div className="mb-1">
                  You&apos;re investing <span className="font-semibold text-text-primary">{formatCurrency(investmentAmountUSD)}</span>
                  {` = `}
                  <span className="font-semibold text-text-primary">{(effectivePercent || 0).toFixed(0)}%</span> ownership of this property.
                </div>
                <div>
                  Expected annualized return: <span className="font-semibold text-green-500">{formatCurrency(expectedAnnualReturnUSD)}</span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="text-sm text-text-secondary">
                  Price: <span className="font-medium text-text-primary">{formatCurrency(priceUSD)}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={loading}
                    className="px-4 py-2 rounded-lg border border-border-subtle bg-bg-secondary text-text-primary text-sm hover:cursor-pointer btn-glow disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={
                      loading ||
                      (effectivePercent || 0) < 1 ||
                      (remainingPercent != null && (effectivePercent || 0) > remainingPercent) ||
                      (remainingPercent == null && (effectivePercent || 0) > 100)
                    }
                    className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-hover hover:cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm btn-glow border border-transparent"
                    onClick={() => onInvest(effectivePercent)}
                  >
                    {loading ? "Processing..." : "Continue"}
                  </button>
                </div>
              </div>
            </div>

            {loading && (
              <div className="absolute inset-0 rounded-xl bg-bg-primary/70 backdrop-blur-sm flex items-center justify-center">
                <div className="flex items-center gap-3 text-text-primary">
                  <Spinner size={20} />
                  <span>Processing your investment...</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
