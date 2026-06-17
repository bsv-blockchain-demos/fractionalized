"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Properties } from "../lib/mongo";
import { useAuthContext } from "../context/walletContext";
import { Spinner } from "./spinner";
import { toast } from "react-hot-toast";
import SellingListings from "./dashboard/SellingListings";
import MarketListings from "./dashboard/MarketListings";
import PortfolioStats from "./dashboard/PortfolioStats";
import { OrdinalsP2MS } from "../utils/ordinalsP2MS";
import { OrdinalsP2PKH } from "../utils/ordinalsP2PKH";
import { broadcastTX } from "../hooks/overlayFunctions";
import { calcTokenTransfer } from "../hooks/calcTokenTransfer";
import { Hash, Transaction, SatoshisPerKilobyte, UnlockingScript } from "@bsv/sdk";
import { parseOutpoint, toOutpoint } from "../utils/outpoints";
import { SERVER_PUBLIC_KEY } from "../utils/env";
import { generateNonce, deriveMultisigPair, deriveOwnKey, TOKEN_PROTOCOL } from "../utils/tokenDerivation";
import { internalizeToBasket } from "../utils/internalizeToBasket";
import { decodeBeef, encodeBeef } from "../utils/beefEncoding";

const SERVER_PUB_KEY = SERVER_PUBLIC_KEY;

export function Dashboard() {
  // User shares mapped to properties
  const [investedCards, setInvestedCards] = useState<
    { property: Properties; percent: number }[]
  >([]);
  const [selling, setSelling] = useState<Properties[]>([]);
  const [myListings, setMyListings] = useState<Array<{
    _id: string;
    propertyId: string;
    name: string;
    location: string;
    sellAmount: number;
    pricePerShare: number;
    listingNonce?: string;
    listingOutpoint?: string;
    listingBeef?: string;
    tokenTxid?: string;
  }>>([]);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const [loadingInvestments, setLoadingInvestments] = useState<boolean>(false);
  const [loadingSelling, setLoadingSelling] = useState<boolean>(false);
  const [loadingMyListings, setLoadingMyListings] = useState<boolean>(false);
  const { userWallet, userPubKey, initializeWallet } = useAuthContext();

  useEffect(() => {
    const fetchInvestedProperties = async () => {
      setLoadingInvestments(true);
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

        // Get owned shares
        const response = await fetch("/api/my-shares", { method: "POST" });
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        const data = await response.json();
        const shares: Array<{
          _id: string;
          propertyId: string;
          amount: number; // percent
        }> = (data?.shares || []).map((s: any) => ({
          _id: String(s?._id ?? ""),
          propertyId: String(s?.propertyId ?? ""),
          amount: Number(s?.amount ?? 0),
        }));

        if (!shares.length) {
          setInvestedCards([]);
          return;
        }

        // Fetch property details for each share
        const props = await Promise.all(
          shares.map(async (s) => {
            const res = await fetch(`/api/properties/${s.propertyId}`);
            if (!res.ok) {
              throw new Error(`Property HTTP ${res.status}`);
            }
            const pd = await res.json();
            return { property: pd?.item as Properties, percent: s.amount };
          })
        );

        // Filter out any failed/undefined items just in case
        const valid = props.filter(
          (p): p is { property: Properties; percent: number } => !!p?.property
        );
        setInvestedCards(valid);
      } catch (e: any) {
        console.error(e);
        toast.error("Failed to load your investments");
      } finally {
        setLoadingInvestments(false);
      }
    };
    fetchInvestedProperties();
    // Re-run if the user identity changes
  }, [userWallet, userPubKey, initializeWallet]);

  // Fetch user's market listings (unsold)
  useEffect(() => {
    const fetchMyListings = async () => {
      setLoadingMyListings(true);
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

        const response = await fetch("/api/my-listings", { method: "POST" });
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        const data = await response.json();
        const items = Array.isArray(data?.items) ? data.items : [];
        setMyListings(items.map((i: any) => ({
          _id: String(i?._id ?? ""),
          propertyId: String(i?.propertyId ?? ""),
          name: String(i?.name ?? "Unknown Property"),
          location: String(i?.location ?? "Unknown"),
          sellAmount: Number(i?.sellAmount ?? 0),
          pricePerShare: Number(i?.pricePerShare ?? 0),
          listingNonce: i?.listingNonce ? String(i.listingNonce) : undefined,
          listingOutpoint: i?.listingOutpoint ? String(i.listingOutpoint) : undefined,
          listingBeef: i?.listingBeef ? String(i.listingBeef) : undefined,
          tokenTxid: i?.tokenTxid ? String(i.tokenTxid) : undefined,
        })));
      } catch (e) {
        console.error(e);
        toast.error("Failed to load your listings");
      } finally {
        setLoadingMyListings(false);
      }
    };
    fetchMyListings();
  }, [userWallet, userPubKey, initializeWallet]);

  // Fetch properties the user is selling
  useEffect(() => {
    const fetchSellingProperties = async () => {
      setLoadingSelling(true);
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

        // Get selling properties
        const response = await fetch("/api/my-selling", { method: "POST" });
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        const data = await response.json();
        const props: Properties[] = data?.items || [];

        // Filter out any failed/undefined items just in case
        const valid = props.filter(
          (p): p is Properties => !!p
        );
        setSelling(valid);
      } catch (e: any) {
        console.error(e);
        toast.error("Failed to load your selling properties");
      } finally {
        setLoadingSelling(false);
      }
    };
    fetchSellingProperties();
    // Re-run if the user identity changes
  }, [userWallet, userPubKey, initializeWallet]);

  // Cancel a listing: reclaim the share from the multisig(seller+server) back to the seller's
  // own self-custody P2PKH. The seller builds + signs the spend client-side.
  const handleCancelListing = async (item: {
    _id: string;
    propertyId: string;
    sellAmount: number;
    listingNonce?: string;
    listingOutpoint?: string;
    listingBeef?: string;
    tokenTxid?: string;
  }) => {
    if (cancellingId) return;
    if (!item.listingNonce || !item.listingOutpoint || !item.listingBeef || !item.tokenTxid) {
      toast.error("This listing can't be cancelled automatically (missing listing data)", {
        duration: 5000, position: "top-center", id: "cancel-error",
      });
      return;
    }

    setCancellingId(item._id);
    try {
      if (!userWallet) {
        try {
          await initializeWallet();
        } catch (e) {
          console.error("Failed to initialize wallet:", e);
          toast.error("Failed to connect wallet", { duration: 5000, position: "top-center", id: "wallet-connect-error" });
          return;
        }
      }
      if (!userPubKey) {
        toast.error("Failed to get public key", { duration: 5000, position: "top-center", id: "public-key-error" });
        return;
      }

      const listingOutpoint = item.listingOutpoint;
      const { vout: listingVout } = parseOutpoint(listingOutpoint);

      // Source tx for the listing multisig output (from the backed-up BEEF).
      const fullListingTx = Transaction.fromBEEF(decodeBeef(item.listingBeef));
      // Token amount carried by the multisig output (amount=0 => full balance of that output).
      const shares = await calcTokenTransfer(fullListingTx, listingVout, 0);

      // Derive both multisig child keys (seller signs with sellerChild; serverChild rebuilds the script).
      const { selfKey: sellerChild, counterpartyKey: serverChild } = await deriveMultisigPair(
        userWallet!, SERVER_PUB_KEY, item.listingNonce,
      );

      // Reclaim output: seller's own derived P2PKH (fresh nonce) — same shape as any held share.
      const cancelNonce = generateNonce();
      const ownKey = await deriveOwnKey(userWallet!, SERVER_PUB_KEY, cancelNonce);
      const reclaimLockingScript = new OrdinalsP2PKH().lock(
        /* address */ Hash.hash160(ownKey, "hex") as number[],
        /* assetId */ listingOutpoint.replace(".", "_"),
        /* tokenTxid */ item.tokenTxid,
        /* shares */ shares,
        /* type */ "transfer",
      );

      // Unlock the listing multisig AS THE SELLER (seller is FIRST in committed [seller, server]).
      const ordinalUnlockFrame = new OrdinalsP2MS().unlock(
        /* wallet */ userWallet!,
        /* keyID */ item.listingNonce,
        /* counterparty */ SERVER_PUB_KEY,
        /* otherPubkey */ serverChild,
        /* signOutputs */ "single",
        /* anyoneCanPay */ true,
        /* sourceSatoshis */ undefined,
        /* lockingScript */ undefined,
        /* firstPubkeyIsWallet */ true,
        /* protocolID */ TOKEN_PROTOCOL,
      );

      // Preimage tx mirroring the intended spend for the correct ordinal signature.
      const preimageTx = new Transaction();
      preimageTx.addInput({
        sourceTransaction: fullListingTx,
        sourceOutputIndex: listingVout,
        unlockingScriptTemplate: ordinalUnlockFrame,
      });
      preimageTx.addOutput({ satoshis: 1, lockingScript: reclaimLockingScript });
      await preimageTx.fee(new SatoshisPerKilobyte(100));
      await preimageTx.sign();
      const ordinalUnlockingScript = preimageTx.inputs[0].unlockingScript as UnlockingScript;
      const ordinalUnlockingScriptLength = ordinalUnlockingScript.toHex().length / 2;

      const actionRes = await userWallet!.createAction({
        description: "Cancel listing",
        inputBEEF: decodeBeef(item.listingBeef),
        inputs: [
          {
            inputDescription: "Listing share",
            outpoint: listingOutpoint,
            unlockingScriptLength: ordinalUnlockingScriptLength,
          },
        ],
        outputs: [
          {
            outputDescription: "Reclaimed share",
            satoshis: 1,
            lockingScript: reclaimLockingScript.toHex(),
          },
        ],
        options: { randomizeOutputs: false, acceptDelayedBroadcast: false },
      });

      if (!actionRes?.signableTransaction) {
        toast.error("Failed to create transaction", { duration: 5000, position: "top-center", id: "cancel-error" });
        return;
      }

      const reference = actionRes.signableTransaction.reference;
      const txToSign = Transaction.fromBEEF(actionRes.signableTransaction.tx);
      txToSign.inputs[0].unlockingScriptTemplate = ordinalUnlockFrame;
      txToSign.inputs[0].sourceTransaction = fullListingTx;
      await txToSign.sign();
      const finalOrdinalUnlockingScript = txToSign.inputs[0].unlockingScript?.toHex();
      if (!finalOrdinalUnlockingScript) {
        toast.error("Failed to create transaction", { duration: 5000, position: "top-center", id: "cancel-error" });
        return;
      }

      const cancelTx = await userWallet!.signAction({
        reference,
        spends: { "0": { unlockingScript: finalOrdinalUnlockingScript } },
      });
      if (!cancelTx?.txid) {
        toast.error("Failed to sign transaction", { duration: 5000, position: "top-center", id: "cancel-error" });
        return;
      }

      // Broadcast to overlay (non-fatal).
      const cancelFullTx = Transaction.fromBEEF(cancelTx.tx as number[]);
      await broadcastTX(cancelFullTx);

      // Persist: record reclaimed share, remove the listing + its BEEF backup.
      const res = await fetch("/api/cancel-listing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketItemId: item._id,
          returnTxid: toOutpoint(cancelTx.txid as string, 0),
          cancelBeef: encodeBeef(cancelTx.tx as number[]),
          cancelNonce,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.error || "Failed to cancel listing", { duration: 5000, position: "top-center", id: "cancel-error" });
        return;
      }

      // Internalize the reclaimed P2PKH (output 0) into the seller's basket.
      try {
        await internalizeToBasket(
          userWallet!,
          cancelTx.tx as number[],
          [{ outputIndex: 0, keyId: cancelNonce, counterparty: SERVER_PUB_KEY, tags: ["type:share"] }],
          "Reclaim listed share",
        );
      } catch (e) {
        console.error("[handleCancelListing] Failed to internalize reclaimed share:", e);
      }

      // Remove from local UI (listing is no longer active).
      setMyListings((prev) => prev.filter((l) => l._id !== item._id));
      toast.success("Listing cancelled", { duration: 4000, position: "top-center", id: "cancel-success" });
    } catch (e) {
      console.error("[handleCancelListing] Error:", e);
      toast.error("Failed to cancel listing", { duration: 5000, position: "top-center", id: "cancel-error" });
    } finally {
      setCancellingId(null);
    }
  };

  const investedProperties = investedCards;

  const parsePercent = (s: string) => {
    const n = parseFloat(String(s).replace("%", ""));
    return isNaN(n) ? 0 : n;
  };

  const formatCurrency = (amount: number) => `USD ${amount.toLocaleString()}`;

  // Portfolio stats
  const stats = useMemo(() => {
    const totalInvestedUSD = investedProperties.reduce((sum, ip) => sum + (ip.property.priceUSD * ip.percent) / 100, 0);
    const expectedYearlyIncomeUSD = investedProperties.reduce((sum, ip) => {
      const annualised = parsePercent(ip.property.annualisedReturn) / 100;
      const invested = (ip.property.priceUSD * ip.percent) / 100;
      return sum + invested * annualised;
    }, 0);
    const avgGrossYield = investedProperties.length
      ? investedProperties.reduce((sum, ip) => sum + parsePercent(ip.property.grossYield), 0) / investedProperties.length
      : 0;
    const positions = investedProperties.length;
    return { totalInvestedUSD, expectedYearlyIncomeUSD, avgGrossYield, positions };
  }, [investedProperties]);

  return (
    <div className="container mx-auto px-4 py-6">
      {/* Your Investments */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-bold text-text-primary">Your Investments</h2>
          <Link href="/properties" className="text-sm link-accent hover:cursor-pointer">
            Explore more properties
          </Link>
        </div>
        {loadingInvestments ? (
          <div className="p-6 rounded-lg bg-bg-tertiary border border-border-subtle text-text-secondary">
            <div className="flex items-center gap-3">
              <Spinner size={20} />
              <span>Loading your investments...</span>
            </div>
          </div>
        ) : investedProperties.length === 0 ? (
          <div className="p-6 rounded-lg bg-bg-tertiary border border-border-subtle text-text-secondary">
            You don’t have any investments yet. Browse properties to get started.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {investedProperties.map(({ property, percent }) => (
              <Link key={String(property._id)} href={`/properties/${property._id}`} className="block">
                <div className="card-glass overflow-hidden transition-all group">
                  {/* Header / Image placeholder */}
                  <div className="relative h-40 bg-gradient-to-br from-accent-primary to-accent-hover">
                    <div className="absolute top-3 left-3 badge-dark text-xs">{percent}% owned</div>
                    <div className="absolute top-3 right-3 badge-success text-xs">{property.status.toUpperCase()}</div>
                    <div className="w-full h-full flex items-center justify-center opacity-60">
                      <div className="text-white text-sm">Property Image</div>
                    </div>
                  </div>

                  {/* Body */}
                  <div className="p-4">
                    <p className="text-xs text-text-secondary mb-1">{property.location}</p>
                    <h3 className="text-lg font-semibold text-text-primary mb-3 line-clamp-2">{property.title}</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-text-secondary">Your stake</span>
                        <span className="font-medium text-text-primary">{percent}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-secondary">Invested</span>
                        <span className="font-medium text-text-primary">{formatCurrency((property.priceUSD * percent) / 100)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-secondary">Expected yearly income</span>
                        <span className="font-medium" style={{ color: "var(--success)" }}>
                          {(() => {
                            const rate = parsePercent(property.annualisedReturn) / 100;
                            const invested = (property.priceUSD * percent) / 100;
                            return formatCurrency(invested * rate);
                          })()}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-text-secondary">Gross yield</span>
                        <span className="font-medium" style={{ color: "var(--info)" }}>{property.grossYield}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="section-divider" />

      {/* Selling listings */}
      <SellingListings selling={selling} />

      <div className="section-divider" />

      {/* Your Market Listings */}
      <MarketListings
        loading={loadingMyListings}
        items={myListings}
        onCancel={handleCancelListing}
        cancellingId={cancellingId}
      />

      <div className="section-divider" />

      {/* Portfolio stats */}
      <PortfolioStats stats={stats} />
    </div>
  );
}