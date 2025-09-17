"use client";

import { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  divider?: boolean;
};

export function PageHeader({ title, subtitle, actions, divider = true }: PageHeaderProps) {
  return (
    <header className="container mx-auto px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-text-primary">{title}</h1>
          {subtitle && (
            <p className="mt-2 text-text-secondary max-w-3xl">{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="shrink-0 flex items-center gap-2">{actions}</div>
        )}
      </div>
      {divider && <div className="section-divider section-divider-compact" />}
    </header>
  );
}
