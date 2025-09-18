"use client";

import { useState, FormEvent } from "react";

type Status = "upcoming" | "open" | "funded" | "sold";

export function Admin() {
    // TODO: Replace this with real submit implementation
    const handleSubmit = async (data: any) => {
        // For now, just log to the console. Replace with API call or DB write.
        console.log("[Admin] New property payload:", data);
        alert("Submitted (demo): check console for payload");
    };

    const [form, setForm] = useState({
        title: "",
        location: "",
        priceAED: "",
        currentValuationAED: "",
        investors: "0",
        status: "open" as Status,
        annualisedReturn: "", // e.g. 11.92%
        grossYield: "",
        netYield: "",
        investmentBreakdown: {
            propertyPrice: "",
            purchaseCost: "",
            transactionCost: "",
            runningCost: "",
        },
        descriptionDetails: "",
        descriptionFeatures: "", // comma-separated
        // Basic set of features; extend as needed
        features: {
            Bedroom: 0,
            Bathroom: 0,
            Toilet: 0,
            Kitchen: 0,
            Balcony: 0,
            Parking: 0,
            LivingRoom: 0,
            Studio: 0,
        } as Record<string, number>,
        images: "", // comma-separated URLs
    });

    const updateField = (key: string, value: any) => setForm((f) => ({ ...f, [key]: value }));
    const updateIB = (key: keyof typeof form.investmentBreakdown, value: any) =>
        setForm((f) => ({ ...f, investmentBreakdown: { ...f.investmentBreakdown, [key]: value } }));
    const updateFeature = (key: string, value: number) =>
        setForm((f) => ({ ...f, features: { ...f.features, [key]: value } }));

    const onSubmit = async (e: FormEvent) => {
        e.preventDefault();
        // Build payload matching the Properties interface (except _id which DB creates)
        const payload = {
            title: form.title.trim(),
            location: form.location.trim(),
            priceAED: Number(form.priceAED || 0),
            investors: Number(form.investors || 0),
            status: form.status,
            annualisedReturn: form.annualisedReturn.trim(),
            currentValuationAED: Number(form.currentValuationAED || 0),
            grossYield: form.grossYield.trim(),
            netYield: form.netYield.trim(),
            investmentBreakdown: {
                propertyPrice: Number(form.investmentBreakdown.propertyPrice || 0),
                purchaseCost: Number(form.investmentBreakdown.purchaseCost || 0),
                transactionCost: Number(form.investmentBreakdown.transactionCost || 0),
                runningCost: Number(form.investmentBreakdown.runningCost || 0),
            },
            description: {
                details: form.descriptionDetails.trim(),
                features: form.descriptionFeatures
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
            },
            features: form.features,
            images: form.images
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
        };

        await handleSubmit(payload);
    };

    return (
        <div className="container mx-auto px-4 py-6">
            <h1 className="text-2xl font-bold mb-4 text-text-primary">Admin: Add Property</h1>

            <form onSubmit={onSubmit} className="space-y-6">
                <div className="rounded-xl border border-border-subtle bg-bg-secondary p-4">
                    <h2 className="text-lg font-semibold mb-3 text-text-primary">Basic Info</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm mb-1 text-text-secondary">Title</label>
                            <input
                                className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary"
                                value={form.title}
                                onChange={(e) => updateField("title", e.target.value)}
                                placeholder="One Bedroom Apartment in ..."
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm mb-1 text-text-secondary">Location</label>
                            <input
                                className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary"
                                value={form.location}
                                onChange={(e) => updateField("location", e.target.value)}
                                placeholder="Dubai Marina, Dubai | Apartment"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm mb-1 text-text-secondary">Status</label>
                            <select
                                className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary"
                                value={form.status}
                                onChange={(e) => updateField("status", e.target.value as Status)}
                            >
                                <option value="upcoming">Upcoming</option>
                                <option value="open">Open</option>
                                <option value="funded">Funded</option>
                                <option value="sold">Sold</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm mb-1 text-text-secondary">Investors</label>
                            <input
                                type="number"
                                min={0}
                                className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary"
                                value={form.investors}
                                onChange={(e) => updateField("investors", e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                <div className="rounded-xl border border-border-subtle bg-bg-secondary p-4">
                    <h2 className="text-lg font-semibold mb-3 text-text-primary">Valuations & Yields</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm mb-1 text-text-secondary">Price (AED)</label>
                            <input
                                type="number"
                                min={0}
                                className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary"
                                value={form.priceAED}
                                onChange={(e) => updateField("priceAED", e.target.value)}
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm mb-1 text-text-secondary">Current Valuation (AED)</label>
                            <input
                                type="number"
                                min={0}
                                className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary"
                                value={form.currentValuationAED}
                                onChange={(e) => updateField("currentValuationAED", e.target.value)}
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm mb-1 text-text-secondary">Annualised Return (%)</label>
                            <input
                                className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary"
                                value={form.annualisedReturn}
                                onChange={(e) => updateField("annualisedReturn", e.target.value)}
                                placeholder="e.g. 11.92%"
                                required
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4 md:col-span-2">
                            <div>
                                <label className="block text-sm mb-1 text-text-secondary">Gross Yield (%)</label>
                                <input
                                    className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary"
                                    value={form.grossYield}
                                    onChange={(e) => updateField("grossYield", e.target.value)}
                                    placeholder="e.g. 7.85%"
                                />
                            </div>
                            <div>
                                <label className="block text-sm mb-1 text-text-secondary">Net Yield (%)</label>
                                <input
                                    className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary"
                                    value={form.netYield}
                                    onChange={(e) => updateField("netYield", e.target.value)}
                                    placeholder="e.g. 5.22%"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="rounded-xl border border-border-subtle bg-bg-secondary p-4">
                    <h2 className="text-lg font-semibold mb-3 text-text-primary">Investment Breakdown (AED)</h2>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div>
                            <label className="block text-sm mb-1 text-text-secondary">Property Price</label>
                            <input
                                type="number"
                                min={0}
                                className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary"
                                value={form.investmentBreakdown.propertyPrice}
                                onChange={(e) => updateIB("propertyPrice", e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-sm mb-1 text-text-secondary">Purchase Cost</label>
                            <input
                                type="number"
                                min={0}
                                className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary"
                                value={form.investmentBreakdown.purchaseCost}
                                onChange={(e) => updateIB("purchaseCost", e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-sm mb-1 text-text-secondary">Transaction Cost</label>
                            <input
                                type="number"
                                min={0}
                                className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary"
                                value={form.investmentBreakdown.transactionCost}
                                onChange={(e) => updateIB("transactionCost", e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-sm mb-1 text-text-secondary">Running Cost</label>
                            <input
                                type="number"
                                min={0}
                                className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary"
                                value={form.investmentBreakdown.runningCost}
                                onChange={(e) => updateIB("runningCost", e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                <div className="rounded-xl border border-border-subtle bg-bg-secondary p-4">
                    <h2 className="text-lg font-semibold mb-3 text-text-primary">Description</h2>
                    <div className="grid grid-cols-1 gap-4">
                        <div>
                            <label className="block text-sm mb-1 text-text-secondary">Details</label>
                            <textarea
                                className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary h-28"
                                value={form.descriptionDetails}
                                onChange={(e) => updateField("descriptionDetails", e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-sm mb-1 text-text-secondary">Features (comma-separated)</label>
                            <input
                                className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary"
                                value={form.descriptionFeatures}
                                onChange={(e) => updateField("descriptionFeatures", e.target.value)}
                                placeholder="e.g. Fitness facilities, Swimming pool, Concierge services"
                            />
                        </div>
                    </div>
                </div>

                <div className="rounded-xl border border-border-subtle bg-bg-secondary p-4">
                    <h2 className="text-lg font-semibold mb-3 text-text-primary">What's In (Counts)</h2>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {Object.keys(form.features).map((k) => (
                            <div key={k}>
                                <label className="block text-sm mb-1 text-text-secondary">{k}</label>
                                <input
                                    type="number"
                                    min={0}
                                    className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary"
                                    value={form.features[k]}
                                    onChange={(e) => updateFeature(k, Number(e.target.value || 0))}
                                />
                            </div>
                        ))}
                    </div>
                </div>

                <div className="rounded-xl border border-border-subtle bg-bg-secondary p-4">
                    <h2 className="text-lg font-semibold mb-3 text-text-primary">Images</h2>
                    <label className="block text-sm mb-1 text-text-secondary">Image URLs (comma-separated)</label>
                    <input
                        className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary"
                        value={form.images}
                        onChange={(e) => updateField("images", e.target.value)}
                        placeholder="/images/foo.jpg, /images/bar.jpg"
                    />
                </div>

                <div className="flex items-center justify-end gap-2">
                    <button
                        type="submit"
                        className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-hover hover:cursor-pointer transition-colors text-sm"
                    >
                        Submit
                    </button>
                </div>
            </form>
        </div>
    );
}