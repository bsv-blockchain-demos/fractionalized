"use client";

import React from "react";

export interface PortfolioStatsData {
  totalInvestedUSD: number;
  expectedYearlyIncomeUSD: number;
  avgGrossYield: number; // percent
  positions: number;
}

export interface PortfolioStatsProps {
  stats: PortfolioStatsData;
}

const formatCurrency = (amount: number) => `USD ${amount.toLocaleString()}`;

export default function PortfolioStats({ stats }: PortfolioStatsProps) {
  return (
    <section className="mb-4">
      <div className="card-elevated p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 text-center">
          <div className="group/stat hover:scale-105 transition-transform duration-300">
            <div className="text-2xl font-bold mb-1 text-accent-primary group-hover/stat:text-accent-subtle transition-colors duration-300">
              {formatCurrency(stats.totalInvestedUSD)}
            </div>
            <div className="text-text-secondary">Total Invested</div>
          </div>
          <div className="group/stat hover:scale-105 transition-transform duration-300">
            <div className="text-2xl font-bold mb-1" style={{ color: "var(--success)" }}>
              {formatCurrency(stats.expectedYearlyIncomeUSD)}
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
  );
}
