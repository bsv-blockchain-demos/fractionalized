"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MarketSellModal } from "./market-sell-modal";
import { MarketPurchaseModal } from "./market-purchase-modal";
import { useAuthContext } from "../context/walletContext";
import { Ordinals } from "../utils/ordinals";
import { broadcastTX, getTransactionByTxID } from "../hooks/overlayFunctions";
import { calcTokenTransfer } from "../hooks/calcTokenTransfer";
import { PaymentUTXO } from "../utils/paymentUtxo";
import { Hash, Transaction } from "@bsv/sdk";
import toast from "react-hot-toast";

const SERVER_PUB_KEY = process.env.NEXT_PUBLIC_SERVER_PUB_KEY;

type MarketItem = {
    _id: string; // mongo id
    propertyId: string; // property id
    sellerId: string; // seller id
    shareId: string; // share id
    sellAmount: number; // sell amount
};

type PropertyMeta = {
    name: string;
    location: string;
    pricePerShareUsd: number;
    tokenTxid: string;
};

type payloadData = {
    shareId: string;
    propertyId: string;
    pricePerShare: number;
    transferTxid: string;
    tokenTxid: string;
}

// Temporary property metadata lookup. Replace with API route using propertyId.
const DUMMY_PROPERTIES: Record<string, PropertyMeta> = {
    "6710c9c0f1a2b2f8a1c00111": {
        name: "Sunset Villas",
        location: "Austin, TX",
        pricePerShareUsd: 125,
        tokenTxid: "",
    },
    "6710c9c0f1a2b2f8a1c00222": {
        name: "Harbor Lofts",
        location: "Seattle, WA",
        pricePerShareUsd: 125,
        tokenTxid: "",
    },
    "6710c9c0f1a2b2f8a1c00333": {
        name: "Pineview Homes",
        location: "Denver, CO",
        pricePerShareUsd: 125,
        tokenTxid: "",
    },
    "6710c9c0f1a2b2f8a1c00444": {
        name: "Lakeside Retreat",
        location: "Madison, WI",
        pricePerShareUsd: 125,
        tokenTxid: "",
    },
};

// TODO: Replace this with a Mongo fetch (e.g., from `/api/properties`)
const DUMMY_ITEMS: MarketItem[] = [
    {
        _id: "m1",
        propertyId: "6710c9c0f1a2b2f8a1c00111",
        sellerId: "s001",
        shareId: "sh001",
        sellAmount: 5,
    },
    {
        _id: "m2",
        propertyId: "6710c9c0f1a2b2f8a1c00222",
        sellerId: "s002",
        shareId: "sh002",
        sellAmount: 12,
    },
    {
        _id: "m3",
        propertyId: "6710c9c0f1a2b2f8a1c00333",
        sellerId: "s003",
        shareId: "sh003",
        sellAmount: 2,
    },
    {
        _id: "m4",
        propertyId: "6710c9c0f1a2b2f8a1c00444",
        sellerId: "s004",
        shareId: "sh004",
        sellAmount: 20,
    },
];

type UIItem = MarketItem & PropertyMeta;

const sortFns: Record<string, (a: UIItem, b: UIItem) => number> = {
    "relevance": () => 0,
    "price-asc": (a, b) => a.pricePerShareUsd - b.pricePerShareUsd,
    "price-desc": (a, b) => b.pricePerShareUsd - a.pricePerShareUsd,
    "amount-desc": (a, b) => b.sellAmount - a.sellAmount,
};

export function Marketplace() {
    const [query, setQuery] = useState("");
    const [sort, setSort] = useState<keyof typeof sortFns>("relevance");
    const [sellOpen, setSellOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [purchaseOpen, setPurchaseOpen] = useState(false);
    const [purchaseLoading, setPurchaseLoading] = useState(false);
    const [purchaseItem, setPurchaseItem] = useState<{
        id: string;
        name: string;
        location: string;
        sellAmount: number;
        pricePerShare: number;
        propertyId: string;
        sellerId: string;
    } | null>(null);

    const { userWallet, userPubKey, initializeWallet } = useAuthContext();

    const handleNewListing = async (payload: payloadData) => {
        const { shareId, propertyId, pricePerShare, transferTxid, tokenTxid } = payload;

        setLoading(true);

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

            if (!userPubKey) {
                toast.error("Failed to get public key", {
                    duration: 5000,
                    position: "top-center",
                    id: "public-key-error",
                });
                return;
            }

            // Verify share ownership
            const traceResult = await fetch("/api/test-chain", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ propertyId, leafTransferTxid: transferTxid, investorId: userPubKey }),
            });
            const data = await traceResult.json();

            if (!data.valid) {
                toast.error(data.reason);
                return;
            }

            // Transfer share to multisig with server
            const txid = transferTxid.split(".")[0];
            const tx = await getTransactionByTxID(txid);

            if (!tx) {
                toast.error("Failed to get transaction", {
                    duration: 5000,
                    position: "top-center",
                    id: "transaction-error",
                });
                return;
            }

            // Get full transaction
            const fullTx = Transaction.fromBEEF(tx.outputs[0].beef);
            const tokens = await calcTokenTransfer(fullTx, 0, 0);

            // Create the unlocking script
            const ordinalUnlockFrame = new Ordinals().unlock(userWallet!, "single");
            const ordinalUnlockingScript = await ordinalUnlockFrame.sign(fullTx, 0);

            const assetId = transferTxid.replace(".", "_");

            // Create the multisig locking script
            const ordinalLockingScript = new Ordinals().lock(userPubKey, assetId, tokenTxid, tokens, "transfer", false, true);

            // Create the transaction
            const newListingTx = await userWallet!.createAction({
                description: "New listing",
                inputBEEF: tx.outputs[0].beef,
                inputs: [
                    {
                        inputDescription: "Share",
                        outpoint: `${transferTxid}.0`,
                        unlockingScript: ordinalUnlockingScript.toHex(),
                    },
                ],
                outputs: [
                    {
                        outputDescription: "Share tokens",
                        satoshis: tokens,
                        lockingScript: ordinalLockingScript.toHex(),
                    },
                ],
                options: {
                    randomizeOutputs: false,
                },
            });

            if (!newListingTx) {
                toast.error("Failed to create transaction", {
                    duration: 5000,
                    position: "top-center",
                    id: "transaction-error",
                });
                return;
            }

            const newListingFullTx = Transaction.fromBEEF(newListingTx.tx as number[]);

            // Broadcast the transaction
            const broadcastResult = await broadcastTX(newListingFullTx);

            if (broadcastResult.status !== "success") {
                toast.error("Failed to broadcast transaction", {
                    duration: 5000,
                    position: "top-center",
                    id: "broadcast-error",
                });
                return;
            }

            // Update the database
            await fetch("/api/new-listing", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ propertyId, sellerId: userPubKey, amount: tokens, parentTxid: transferTxid, transferTxid: `${newListingTx.txid}.0`, pricePerShare }),
            });

            // Close the modal
            setSellOpen(false);

            // Show success message
            toast.success("Listing created successfully", {
                duration: 5000,
                position: "top-center",
                id: "listing-success",
            });
            setLoading(false);
        } catch (e) {
            console.error(e);
            toast.error("Failed to create listing", {
                duration: 5000,
                position: "top-center",
                id: "listing-error",
            });
            setLoading(false);
        }
    };

    const handlePurchase = async (
        { marketItemId, buyerId }: { marketItemId: string; buyerId: string }
    ) => {
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

            setPurchaseLoading(true);
            // Create the paymentTX
            const oneOfTwoHash = Hash.hash160(SERVER_PUB_KEY + buyerId);
            const paymentLockingScript = new PaymentUTXO().lock(oneOfTwoHash);

            const paymentUtxo = await userWallet!.createAction({
                description: "Payment",
                outputs: [
                    {
                        outputDescription: "Fee Payment",
                        satoshis: 2,
                        lockingScript: paymentLockingScript.toHex(),
                    },
                ],
                options: {
                    randomizeOutputs: false,
                },
            });

            if (!paymentUtxo) {
                toast.error("Failed to create payment", {
                    duration: 5000,
                    position: "top-center",
                    id: "payment-error",
                });
                throw new Error("Failed to create payment");
            }

            // Send the paymentTX to the server and start ordinal transfer
            const response = await fetch("/api/listing-purchase", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ marketItemId, buyerId, paymentTX: paymentUtxo }),
            });
            const data = await response.json();
            if (response.status !== 200) {
                toast.error(data.error, {
                    duration: 5000,
                    position: "top-center",
                    id: "purchase-error",
                });
                throw new Error(data.error);
            }
            setPurchaseOpen(false);
        } catch (e) {
            console.error(e);
            toast.error("Failed to purchase", {
                duration: 5000,
                position: "top-center",
                id: "purchase-error",
            });
        } finally {
            setPurchaseLoading(false);
        }
    };

    const uiItems: UIItem[] = useMemo(() => {
        // Merge market items with property meta using propertyId
        return DUMMY_ITEMS.map((mi) => {
            const meta = DUMMY_PROPERTIES[mi.propertyId];
            return {
                ...mi,
                ...(meta || {
                    name: "Unknown Property",
                    location: "Unknown",
                    pricePerShareUsd: 0,
                    availablePercent: 0,
                    totalShares: 0,
                }),
            } as UIItem;
        });
    }, []);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        const base = q
            ? uiItems.filter((i) => `${i.name} ${i.location}`.toLowerCase().includes(q))
            : uiItems;
        const sorter = sortFns[sort] || sortFns["relevance"];
        return [...base].sort(sorter);
    }, [query, sort, uiItems]);

    return (
        <div className="container mx-auto px-4">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-semibold text-text-primary">Marketplace</h1>
            </div>

            <div className="bg-bg-secondary border border-border-subtle rounded-xl p-4 mb-6">
                <div className="flex flex-col md:flex-row md:items-center gap-3">
                    <div className="flex-1">
                        <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search by name or location"
                            className="w-full rounded-lg border border-border-subtle bg-bg-primary text-text-primary placeholder-text-muted px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
                        />
                    </div>
                    <div className="w-full md:w-56">
                        <select
                            value={sort}
                            onChange={(e) => setSort(e.target.value as keyof typeof sortFns)}
                            className="w-full rounded-lg border border-border-subtle bg-bg-primary text-text-primary px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-primary/30"
                        >
                            <option value="relevance">Sort: Relevance</option>
                            <option value="price-asc">Price per share: Low to High</option>
                            <option value="price-desc">Price per share: High to Low</option>
                            <option value="amount-desc">For sale amount: High to Low</option>
                        </select>
                    </div>
                    <div className="md:ml-auto">
                        <button
                            type="button"
                            onClick={() => setSellOpen(true)}
                            className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-sm btn-glow"
                            aria-label="Sell share"
                        >
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white/20">+</span>
                            <span>Sell share</span>
                        </button>
                    </div>
                </div>
            </div>

            <div className="section-divider" />

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {filtered.map((item) => (
                    <div
                        key={item._id}
                        className="card-glass group bg-bg-secondary border border-border-subtle rounded-xl overflow-hidden hover:shadow-md transition-shadow"
                    >
                        {/* Image placeholder */}
                        <div className="h-36 bg-bg-primary/60 flex items-center justify-center">
                            <div className="w-14 h-14 bg-accent-primary/20 rounded-lg flex items-center justify-center">
                                <span className="text-accent-primary font-semibold">IMG</span>
                            </div>
                        </div>

                        <div className="p-4 space-y-3">
                            <div>
                                <h3 className="text-lg font-semibold text-text-primary leading-snug">
                                    {item.name}
                                </h3>
                                <p className="text-sm text-text-secondary">{item.location}</p>
                            </div>

                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs text-text-secondary">Price / share</p>
                                    <p className="text-text-primary font-medium">${""}{item.pricePerShareUsd.toFixed(0)}</p>
                                </div>
                            </div>

                            <p className="text-xs text-text-secondary">For sale: {item.sellAmount}</p>

                            <div className="flex items-center gap-2 pt-1">
                                <Link
                                    href={`/properties/${item.propertyId}`}
                                    className="flex-1 text-center bg-bg-primary hover:bg-bg-primary/80 text-text-primary border border-border-subtle rounded-lg px-3 py-2 transition-colors btn-glow"
                                >
                                    View
                                </Link>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setPurchaseItem({
                                            id: item._id,
                                            name: item.name,
                                            location: item.location,
                                            sellAmount: item.sellAmount,
                                            pricePerShare: item.pricePerShareUsd,
                                            propertyId: item.propertyId,
                                            sellerId: item.sellerId,
                                        });
                                        setPurchaseOpen(true);
                                    }}
                                    className="flex-1 text-center bg-accent-primary hover:bg-accent-primary/90 text-white rounded-lg px-3 py-2 transition-colors btn-glow"
                                >
                                    Buy
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {filtered.length === 0 && (
                <div className="text-center text-text-secondary py-16 border border-dashed border-border-subtle rounded-xl">
                    No results. Try a different search.
                </div>
            )}

            {/* Sell modal */}
            <MarketSellModal
                open={sellOpen}
                loading={loading}
                onClose={() => setSellOpen(false)}
                onListed={(payload) => {
                    handleNewListing(payload);
                }}
            />

            {/* Purchase modal */}
            <MarketPurchaseModal
                open={purchaseOpen}
                loading={purchaseLoading}
                item={purchaseItem}
                onClose={() => setPurchaseOpen(false)}
                onBuy={handlePurchase}
            />
        </div>
    );
}