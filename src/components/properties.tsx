import { properties } from '../lib/dummydata';
import Link from 'next/link';

export function Properties() {
    const formatCurrency = (amount: number) => {
        return `AED ${amount.toLocaleString()}`;
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric' 
        });
    };

    return (
        <div className="container mx-auto px-4 py-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {properties.map((property) => (
                    <Link key={property.id} href={`/properties/${property.id}`} className="block">
                        <div className="bg-white rounded-lg shadow-lg overflow-hidden hover:shadow-xl transition-shadow cursor-pointer">
                        {/* Property Image */}
                        <div className="relative h-48 bg-gradient-to-br from-blue-400 to-blue-600">
                            {/* Status Badge */}
                            <div className="absolute top-3 left-3 bg-black bg-opacity-80 text-white px-3 py-1 rounded text-sm font-medium">
                                FUNDED
                            </div>
                            
                            {/* Image pagination indicator */}
                            <div className="absolute bottom-3 right-3 bg-black bg-opacity-60 text-white px-2 py-1 rounded text-xs">
                                1/{Math.floor(Math.random() * 9) + 1}
                            </div>
                            
                            {/* Placeholder for property image - using gradient background */}
                            <div className="w-full h-full bg-gradient-to-br from-slate-300 to-slate-500 flex items-center justify-center">
                                <div className="text-white text-opacity-50 text-sm">Property Image</div>
                            </div>
                        </div>

                        {/* Property Details */}
                        <div className="p-4">
                            {/* Location */}
                            <p className="text-xs text-gray-500 mb-1">{property.location}</p>
                            
                            {/* Title */}
                            <h3 className="text-lg font-semibold text-gray-900 mb-3 line-clamp-2">
                                {property.title}
                            </h3>

                            {/* Price and Investors */}
                            <div className="flex justify-between items-center mb-4">
                                <div className="text-xl font-bold text-gray-900">
                                    {formatCurrency(property.priceAED)}
                                </div>
                                <div className="text-sm text-gray-600">
                                    {property.investors} investors
                                </div>
                            </div>

                            {/* Investment Metrics */}
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Annualised return</span>
                                    <span className="font-medium text-gray-900">{property.annualisedReturn}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Current valuation</span>
                                    <span className="font-medium text-gray-900">{formatCurrency(property.currentValuationAED)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Funded date</span>
                                    <span className="font-medium text-gray-900">{formatDate(property.fundedDate)}</span>
                                </div>
                            </div>
                        </div>
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    );
}