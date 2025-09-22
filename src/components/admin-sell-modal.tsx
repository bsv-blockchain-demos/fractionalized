"use client";

import { useMemo, useState } from "react";
import { Modal } from "./modal";

export type SellSharesConfig = {
  sharesCount: number;
  percentPerShare: number; // 0..100
};

export function SellSharesModal({
  isOpen,
  onClose,
  onSubmit,
  initial,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (config: SellSharesConfig) => void;
  initial?: Partial<SellSharesConfig>;
}) {
  const [sharesCount, setSharesCount] = useState<number>(initial?.sharesCount ?? 10);
  const [percentPerShare, setPercentPerShare] = useState<number>(initial?.percentPerShare ?? 5);
  const [showWarning, setShowWarning] = useState(false);
  const [warningType, setWarningType] = useState<null | "soft" | "hard">(null);

  const totalPercent = useMemo(() => (sharesCount || 0) * (percentPerShare || 0), [sharesCount, percentPerShare]);
  const isOver100 = totalPercent > 100;
  const isSoftWarning = totalPercent > 99 && totalPercent <= 100;

  const handleApply = () => {
    // Disallow out-of-range totals
    if (isOver100) {
      setWarningType("hard");
      setShowWarning(true);
      return;
    }
    // Warning flow when >99% and <= 100%
    if (isSoftWarning) {
      setWarningType("soft");
      setShowWarning(true);
      return;
    }
    onSubmit({ sharesCount: Math.max(0, Math.floor(sharesCount || 0)), percentPerShare: Math.max(0, Number(percentPerShare || 0)) });
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Configure Shares to Sell">
        <div className="space-y-5">
          <div className="text-sm text-red-400">
            This is a demo app, please do not try to sell your actual real estate.
          </div>
          <div className="text-xs md:text-sm text-text-secondary">
            Define how many shares you want to sell and what percent ownership each share represents.
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-1 text-text-secondary">Number of shares</label>
              <input
                type="number"
                min={0}
                value={sharesCount}
                onChange={(e) => setSharesCount(Math.max(0, Math.floor(Number(e.target.value || 0))))}
                className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-secondary text-text-primary"
              />
            </div>
            <div>
              <label className="block text-sm mb-1 text-text-secondary">Percent per share (%)</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={percentPerShare}
                onChange={(e) => setPercentPerShare(Math.max(0, Number(e.target.value || 0)))}
                className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-secondary text-text-primary"
              />
            </div>
          </div>

          <div className="p-3 rounded-lg border border-border-subtle bg-bg-tertiary text-sm">
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Total ownership offered</span>
              <span className={(isOver100 || isSoftWarning) ? "font-semibold text-red-400" : "font-semibold text-text-primary"}>
                {totalPercent.toFixed(2)}%
              </span>
            </div>
            {isOver100 ? (
              <div className="mt-2 text-xs text-red-400">Error: Total offered cannot exceed 100%.</div>
            ) : isSoftWarning ? (
              <div className="mt-2 text-xs text-red-400">Warning: You are offering more than 99% in total. You may not retain any ownership.</div>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              className="px-4 py-2 rounded-lg border border-border-subtle bg-bg-secondary text-text-primary text-sm btn-glow"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-hover transition-colors text-sm btn-glow border border-transparent"
              onClick={handleApply}
              disabled={sharesCount <= 0 || percentPerShare <= 0}
            >
              Apply
            </button>
          </div>
        </div>
      </Modal>

      {/* Warning modal */}
      <Modal
        isOpen={showWarning}
        onClose={() => setShowWarning(false)}
        title={warningType === "hard" ? "Cannot proceed" : "Warning"}
      >
        <div className="space-y-4">
          {warningType === "hard" ? (
            <div className="text-sm text-text-primary">
              Your current configuration offers {totalPercent.toFixed(2)}%. You cannot offer more than 100% in total.
            </div>
          ) : (
            <div className="text-sm text-text-primary">
              Your current configuration offers {totalPercent.toFixed(2)}%. If you proceed, you may not retain any ownership yourself.
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className="px-4 py-2 rounded-lg border border-border-subtle bg-bg-secondary text-text-primary text-sm btn-glow"
              onClick={() => setShowWarning(false)}
            >
              {warningType === "hard" ? "OK" : "Cancel"}
            </button>
            {warningType === "soft" && (
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-hover transition-colors text-sm btn-glow border border-transparent"
                onClick={() => {
                  onSubmit({ sharesCount: Math.max(0, Math.floor(sharesCount || 0)), percentPerShare: Math.max(0, Number(percentPerShare || 0)) });
                  setShowWarning(false);
                }}
              >
                Proceed anyway
              </button>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
