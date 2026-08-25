import { Link } from 'react-router-dom';
import type { PublicProperty } from '@shared/types';
import { PropertyImage } from './PropertyImage';

export interface PropertyGridProps {
  items: PublicProperty[];
}

const formatCurrency = (amount: number | undefined) => {
  if (typeof amount !== "number") return "USD 0";
  return `USD ${amount.toLocaleString()}`;
};

export default function PropertyGrid({ items }: PropertyGridProps) {
  if (!items || items.length === 0) {
    return (
      <div className="p-4 rounded-lg bg-bg-tertiary border border-border-subtle text-sm text-text-secondary">
        No properties to display.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {items.map((property) => {
        return (
          <Link key={property._id} to={`/properties/${property._id}`} className="block">
            <div className="card-glass overflow-hidden transition-all cursor-pointer group">
              {/* Property Image */}
              <div className="relative h-48 bg-gradient-to-br from-accent-primary to-accent-hover">
                {/* Status Badge */}
                <div
                  className={
                    `absolute top-3 left-3 ` +
                    (property.status === 'funded'
                      ? 'badge-success'
                      : property.status === 'open'
                        ? 'badge-dark'
                        : property.status === 'upcoming'
                          ? 'badge-dark'
                          : 'badge-dark')
                  }
                >
                  {String(property.status || '').toUpperCase()}
                </div>
                <PropertyImage images={property.images} alt={property.title}>
                  <div className="w-full h-full flex items-center justify-center opacity-60">
                    <div className="text-white text-sm">Property Image</div>
                  </div>
                </PropertyImage>
              </div>

              {/* Property Details */}
              <div className="p-4">
                {/* Location */}
                <p className="text-xs text-text-secondary mb-1">{property.location}</p>

                {/* Title */}
                <h3 className="text-lg font-semibold text-text-primary mb-3 line-clamp-2">
                  {property.title}
                </h3>

                {/* Price and Investors */}
                <div className="flex justify-between items-center mb-4">
                  <div className="text-xl font-bold text-text-primary">
                    {formatCurrency(property.priceUSD as number)}
                  </div>
                  <div className="text-sm text-text-secondary">
                    {property.investors} investors
                  </div>
                </div>

                {/* Investment Metrics */}
                <div className="space-y-2 text-sm">
                  {property.sell?.percentToSell != null && property.availablePercent != null && (
                    <div className="flex justify-between">
                      <span className="text-text-secondary">Available shares</span>
                      <span className="font-medium text-accent-primary">
                        {property.availablePercent.toFixed(1)}% of {property.sell.percentToSell}%
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Annualised return</span>
                    <span className="font-medium text-text-primary">{property.annualisedReturn}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Current valuation</span>
                    <span className="font-medium text-text-primary">{formatCurrency(property.currentValuationUSD as number)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Gross yield</span>
                    <span className="font-medium text-text-primary">{property.grossYield}</span>
                  </div>
                </div>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
