"use client";

import Link from "next/link";

export function Home() {
    return (
        <div className="container mx-auto px-4 py-8">
            {/* Hero Section */}
            <div className="text-center mb-16">
                <h1 className="text-5xl font-bold mb-6 text-text-primary">
                    Invest in Real Estate,
                    <span className="text-accent-primary"> Fractionalized</span>
                </h1>
                <p className="text-xl mb-8 max-w-3xl mx-auto text-text-secondary">
                    Access premium real estate investments with lower capital requirements.
                    Own fractions of high-value properties and earn rental income.
                </p>
            </div>

            {/* Features Section */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
                <div className="card-glass text-center p-8 group">
                    <div className="w-16 h-16 bg-gradient-blue rounded-full mx-auto mb-4 flex items-center justify-center shadow-card-hover group-hover:shadow-card-lift transition-all duration-300">
                        <span className="text-2xl icon-hover">🏢</span>
                    </div>
                    <h3 className="text-xl font-bold mb-3 text-accent-primary group-hover:text-accent-subtle transition-colors duration-300">
                        Premium Properties
                    </h3>
                    <p className="text-text-secondary group-hover:text-text-primary transition-colors duration-300">
                        Access high-value commercial and residential properties in prime locations
                    </p>
                </div>

                <div className="card-glass text-center p-8 group">
                    <div className="w-16 h-16 bg-gradient-to-br from-success to-emerald-600 rounded-full mx-auto mb-4 flex items-center justify-center shadow-card-hover group-hover:shadow-card-lift transition-all duration-300">
                        <span className="text-2xl icon-hover">💰</span>
                    </div>
                    <h3 className="text-xl font-bold mb-3 text-success group-hover:text-emerald-400 transition-colors duration-300">
                        Steady Returns
                    </h3>
                    <p className="text-text-secondary group-hover:text-text-primary transition-colors duration-300">
                        Earn regular rental income and benefit from property appreciation
                    </p>
                </div>

                <div className="card-glass text-center p-8 group">
                    <div className="w-16 h-16 bg-gradient-to-br from-info to-cyan-600 rounded-full mx-auto mb-4 flex items-center justify-center shadow-card-hover group-hover:shadow-card-lift transition-all duration-300">
                        <span className="text-2xl icon-hover">📊</span>
                    </div>
                    <h3 className="text-xl font-bold mb-3 text-info group-hover:text-cyan-400 transition-colors duration-300">
                        Low Entry Point
                    </h3>
                    <p className="text-text-secondary group-hover:text-text-primary transition-colors duration-300">
                        Start investing with as little as USD 1,000 through fractional ownership
                    </p>
                </div>
            </div>

            {/* Section Divider */}
            <div className="section-divider"></div>

            {/* Stats Section */}
            <div className="card-elevated mb-16 group">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-8 text-center">
                    <div className="group/stat hover:scale-105 transition-transform duration-300">
                        <div className="text-3xl font-bold mb-2 text-accent-primary group-hover/stat:text-accent-subtle transition-colors duration-300">
                            USD 50M+
                        </div>
                        <div className="text-text-secondary group-hover/stat:text-text-primary transition-colors duration-300">
                            Total Investment Volume
                        </div>
                    </div>
                    <div className="group/stat hover:scale-105 transition-transform duration-300">
                        <div className="text-3xl font-bold mb-2 text-success group-hover/stat:text-emerald-400 transition-colors duration-300">
                            8.5%
                        </div>
                        <div className="text-text-secondary group-hover/stat:text-text-primary transition-colors duration-300">
                            Average Annual Return
                        </div>
                    </div>
                    <div className="group/stat hover:scale-105 transition-transform duration-300">
                        <div className="text-3xl font-bold mb-2 text-info group-hover/stat:text-cyan-400 transition-colors duration-300">
                            2,500+
                        </div>
                        <div className="text-text-secondary group-hover/stat:text-text-primary transition-colors duration-300">
                            Active Investors
                        </div>
                    </div>
                    <div className="group/stat hover:scale-105 transition-transform duration-300">
                        <div className="text-3xl font-bold mb-2 text-warning group-hover/stat:text-amber-400 transition-colors duration-300">
                            150+
                        </div>
                        <div className="text-text-secondary group-hover/stat:text-text-primary transition-colors duration-300">
                            Properties Listed
                        </div>
                    </div>
                </div>
            </div>

            {/* Section Divider */}
            <div className="section-divider"></div>

            {/* CTA Section */}
            <div className="text-center">
                <h2 className="text-3xl font-bold mb-4 text-text-primary">
                    Ready to Start Your Investment Journey?
                </h2>
                <p className="text-lg mb-8 text-text-secondary">
                    Browse our curated selection of premium properties and start building your portfolio today.
                </p>
                <Link 
                    href="/properties"
                    className="inline-flex items-center justify-center px-10 py-4 bg-gradient-blue hover:bg-gradient-blue-subtle text-white rounded-xl font-semibold text-lg transition-all duration-300 hover:shadow-card-lift hover:scale-105 focus:outline-none focus:ring-4 focus:ring-accent-primary/30 group relative overflow-hidden"
                >
                    <span className="relative z-10 flex items-center gap-2">
                        View Properties
                        <svg className="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                    </span>
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 ease-out"></div>
                </Link>
            </div>
        </div>
    );
}