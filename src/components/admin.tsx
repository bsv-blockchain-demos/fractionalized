"use client";

import { useState, FormEvent, useMemo, useRef } from "react";
import { InfoTip } from "./info-tip";
import { SellSharesModal, type SellSharesConfig } from "./admin-sell-modal";
import { useAuthContext } from "../context/walletContext";
import { toast } from "react-hot-toast";
import { Hash, Utils, LockingScript, OP, UnlockingScript, PublicKey, Signature, TransactionSignature, Transaction } from "@bsv/sdk";
import { OrdinalsP2PKH } from "../utils/ordinalsP2PKH";
import { OrdinalsP2MS } from "../utils/ordinalsP2MS";
import { SERVER_PUBKEY } from "../utils/env";
import { PaymentUtxo } from "../utils/paymentUtxo";
import { toOutpoint } from "../utils/outpoints";
import { hashFromPubkeys } from "@/utils/hashFromPubkeys";

type Status = "upcoming" | "open" | "funded" | "sold";
type StepStatus = "idle" | "running" | "success" | "error";

export function Admin() {
    // Character limits (must match server validators in validators.ts)
    const MAX_DETAILS = 1500;
    const MAX_WHY_TITLE = 80;
    const MAX_WHY_TEXT = 400;
    const MAX_TITLE = 80;
    const MAX_LOCATION = 80;
    const [processing, setProcessing] = useState(false);
    const [step1, setStep1] = useState<StepStatus>("idle");
    const [step2, setStep2] = useState<StepStatus>("idle");

    const { userWallet, userPubKey, initializeWallet, checkAuth } = useAuthContext();

    const stepLabels = [
        "Creating property token...",
        "Minting shares for property token...",
    ];

    // Refs for focusing fields on validation errors
    const detailsRef = useRef<HTMLTextAreaElement | null>(null);
    const titleRef = useRef<HTMLInputElement | null>(null);
    const locationRef = useRef<HTMLInputElement | null>(null);
    const priceRef = useRef<HTMLInputElement | null>(null);
    const valuationRef = useRef<HTMLInputElement | null>(null);
    const purchaseRef = useRef<HTMLInputElement | null>(null);
    const transactionRef = useRef<HTMLInputElement | null>(null);
    const runningRef = useRef<HTMLInputElement | null>(null);
    const investorsRef = useRef<HTMLInputElement | null>(null);
    const whyTitleRefs = useRef<Array<HTMLInputElement | null>>([]);
    const whyTextRefs = useRef<Array<HTMLTextAreaElement | null>>([]);

    const focusErrorField = (messages: string[]) => {
        // Prefer first message
        const msg = messages[0] || "";
        // whyInvest[n].title/text
        const m = msg.match(/whyInvest\[(\d+)\]\.(title|text)/);
        if (m) {
            const idx = Number(m[1]);
            const field = m[2];
            const ref = field === 'title' ? whyTitleRefs.current[idx] : whyTextRefs.current[idx];
            if (ref) {
                ref.scrollIntoView({ behavior: 'smooth', block: 'center' });
                ref.focus();
                return;
            }
        }
        // Title / Location
        if ((/title too long/i.test(msg) || /title is required/i.test(msg)) && titleRef.current) {
            titleRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
            titleRef.current.focus();
            return;
        }
        if ((/location too long/i.test(msg) || /location is required/i.test(msg)) && locationRef.current) {
            locationRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
            locationRef.current.focus();
            return;
        }
        // Description details
        if (/Description details too long/i.test(msg) && detailsRef.current) {
            detailsRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
            detailsRef.current.focus();
            return;
        }
        // Currency fields
        if (/priceUSD/i.test(msg) && priceRef.current) {
            priceRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
            priceRef.current.focus();
            return;
        }
        if (/currentValuationUSD/i.test(msg) && valuationRef.current) {
            valuationRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
            valuationRef.current.focus();
            return;
        }
        if (/investmentBreakdown\.purchaseCost/i.test(msg) && purchaseRef.current) {
            purchaseRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
            purchaseRef.current.focus();
            return;
        }
        if (/investmentBreakdown\.transactionCost/i.test(msg) && transactionRef.current) {
            transactionRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
            transactionRef.current.focus();
            return;
        }
        if (/investmentBreakdown\.runningCost/i.test(msg) && runningRef.current) {
            runningRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
            runningRef.current.focus();
            return;
        }
        if (/investors/i.test(msg) && investorsRef.current) {
            investorsRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
            investorsRef.current.focus();
        }
    };

    const handleSubmit = async (_data: any) => {
        const nullFields = Object.entries(_data)
            .filter(([_, value]) => value === null)
            .map(([key]) => key);

        if (nullFields.length > 0) {
            toast.error(`Missing required fields: ${nullFields.join(', ')}`);
            return;
        }
        // Create tokenized transaction from user wallet first
        // Create the amount of shares the user filled in using the returned tokenized transaction
        // Transfer the tokens to the server wallet
        setProcessing(true);
        setStep1("running");
        setStep2("idle");

        const authenticated = await checkAuth();
        if (!authenticated) {
            toast.error('Failed to authenticate', {
                duration: 5000,
                position: 'top-center',
                id: 'authentication-error',
            });
            return;
        }

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
            toast.error('Failed to get public key', {
                duration: 5000,
                position: 'top-center',
                id: 'public-key-error',
            });
            return;
        }

        try {
            // Step 1: Creating property token...
            const pubKeyHash = Hash.hash160(userPubKey, "hex");

            const title = _data.title.trim().toLowerCase();
            const location = _data.location.trim().toLowerCase();
            const propertyDataHash = Hash.hash256(
                Utils.toArray(`${title}-${location}`, "utf8")
            );

            const script = new LockingScript();
            script
                // Single signature lockingScript (P2PKH)
                .writeOpCode(OP.OP_DUP)
                .writeOpCode(OP.OP_HASH160)
                .writeBin(pubKeyHash)
                .writeOpCode(OP.OP_EQUALVERIFY)
                .writeOpCode(OP.OP_CHECKSIGVERIFY)
                // Unreachable if statement that contains the property data hash to verify
                .writeOpCode(OP.OP_RETURN)
                .writeBin(propertyDataHash)

            const response = await userWallet?.createAction({
                description: "Create property token",
                outputs: [
                    {
                        outputDescription: "Property token",
                        satoshis: 1,
                        lockingScript: script.toHex(),
                    },
                ],
                options: {
                    randomizeOutputs: false,
                }
            });
            console.log({ response });
            if (!response?.txid) {
                throw new Error("Failed to create property token");
            }
            const sendToken = await fetch("/api/tokenize/new-property-token", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    tx: response,
                    data: _data,
                    seller: userPubKey,
                }),
            });
            const sendTokenData = await sendToken.json();
            console.log({ sendTokenData });
            if (!sendToken.ok && sendTokenData?.error === "Validation failed") {
                const arr = Array.isArray(sendTokenData?.details) ? sendTokenData.details : [];
                const details = arr.join("; ");
                toast.error(`Validation failed. Please fix: ${details}`, { duration: 6000, position: 'top-center', id: 'validation-failed' });
                if (arr.length > 0) focusErrorField(arr);
                setStep1("error");
                setProcessing(false);
                return;
            }
            if (!sendToken.ok) {
                throw new Error("Failed to send property token");
            }
            setStep1("success");

            // Step 2: Minting shares for property token...
            setStep2("running");
            // Create the ordinal locking script with 1sat inscription
            // Each token represents 1% ownership; mint the requested percentToSell amount
            const tokensToMint = Number(_data?.sell?.percentToSell || 0);
            if (tokensToMint <= 0) {
                throw new Error("Invalid percentToSell");
            } else if (tokensToMint > 100) {
                throw new Error("Percent to sell must be less than or equal to 100");
            }
            const hashOfPubkeys = hashFromPubkeys([PublicKey.fromString(userPubKey), PublicKey.fromString(SERVER_PUBKEY)])
            const ordinalLockingScript = new OrdinalsP2MS().lock(
                hashOfPubkeys,
                `${response.txid}_0`,
                toOutpoint(response.txid, 0),
                tokensToMint,
                "deploy+mint"
            );

            // Create payment UTXO
            // Multisig 1 of 2 so server can use funds for transfer fees
            const serverPubKeyArray = PublicKey.fromString(SERVER_PUBKEY).encode(true) as number[];
            const userPubKeyArray = PublicKey.fromString(userPubKey).encode(true) as number[];
            const oneOfTwoHash = Hash.hash160(serverPubKeyArray.concat(userPubKeyArray));

            const paymentLockingScript = new PaymentUtxo().lock(oneOfTwoHash);
            const paymentChangeLockingScript = new PaymentUtxo().lock(oneOfTwoHash);

            // Calculate required sats for payment UTXO
            // Estimated at 2 sats in fees per share sold, minimum 3 to ensure changeSats >= 1
            const requiredSats = Math.max(3, Math.ceil(Number(_data.sell.percentToSell) * 2));

            const changeSats = Number(requiredSats) - 2;
            if (changeSats < 1) {
                throw new Error("Insufficient satoshis for payment change output");
            }

            const paymentTxAction = await userWallet?.createAction({
                description: "Payment UTXO",
                outputs: [
                    {
                        outputDescription: "Payment outpoint",
                        satoshis: requiredSats,
                        lockingScript: paymentLockingScript.toHex(),
                    },
                ],
                options: {
                    randomizeOutputs: false,
                }
            });

            if (!paymentTxAction?.txid) {
                throw new Error("Failed to create payment UTXO");
            }

            // Build preimage for payment input and sign with PaymentUtxo frame
            const paymentSourceTX = Transaction.fromBEEF(paymentTxAction.tx as number[]);
            const preimageTx = new Transaction();
            preimageTx.addInput({
                sourceTransaction: paymentSourceTX,
                sourceOutputIndex: 0,
            });
            preimageTx.addOutput({
                satoshis: 1,
                lockingScript: ordinalLockingScript,
            });
            preimageTx.addOutput({
                satoshis: changeSats,
                lockingScript: paymentChangeLockingScript,
            });

            const paymentUnlockFrame = new PaymentUtxo().unlock(
                userWallet!,
                SERVER_PUBKEY,
                "single",
                false,
                undefined,
                undefined,
                false // order: server first, then user to match hash(SERVER + user)
            );
            const paymentUnlockingScript = await paymentUnlockFrame.sign(preimageTx, 0);

            // Create the mint transaction
            const actionRes = await userWallet?.createAction({
                description: "Mint shares for property token", 
                inputBEEF: paymentTxAction?.tx,
                inputs: [
                    {
                        inputDescription: "Payment",
                        outpoint: toOutpoint(String(paymentTxAction?.txid), 0),
                        unlockingScript: paymentUnlockingScript.toHex(),
                    },
                ],
                outputs: [
                    {
                        outputDescription: "Share tokens",
                        satoshis: 1,
                        lockingScript: ordinalLockingScript.toHex(),
                    },
                    {
                        outputDescription: "Payment change",
                        satoshis: changeSats,
                        lockingScript: paymentChangeLockingScript.toHex(),
                    },
                ],
                options: {
                    randomizeOutputs: false,
                }
            });
            console.log({ actionRes });
            if (!actionRes?.txid) {
                throw new Error("Failed to mint shares for property token");
            }

            // Send the mint transaction to the server for storage
            console.log({ actionRes });
            const sendMintTx = await fetch("/api/tokenize/initialize-tokens", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    mintTx: actionRes,
                    propertyTokenTxid: toOutpoint(response.txid, 0),
                }),
            });
            const sendMintTxData = await sendMintTx.json();
            console.log({ sendMintTxData });
            if (!sendMintTxData?.ok) {
                throw new Error("Failed to mint shares for property token");
            }
            setStep2("success");
        } catch (e) {
            // If any error occurs, mark the current running step as error
            console.error("Error during tokenization process:", e);
            if (step1 === "running") setStep1("error");
            else if (step2 === "running") setStep2("error");
        } finally {
            setProcessing(false);
        }
    };

    const [form, setForm] = useState({
        title: "",
        location: "",
        priceUSD: "",
        currentValuationUSD: "",
        investors: "0",
        status: "open" as Status,
        annualisedReturn: "", // e.g. 11.92%
        grossYield: "",
        netYield: "",
        investmentBreakdown: {
            purchaseCost: "",
            transactionCost: "",
            runningCost: "",
        },
        whyInvest: [{ title: "", text: "" }],
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
        proofOfOwnership: "", // Base64 encoded PDF
    });

    // Shares modal state
    const [isSellOpen, setSellOpen] = useState(false);
    const [sellConfig, setSellConfig] = useState<SellSharesConfig>({ percentToSell: 80 });

    const updateField = (key: string, value: any) => setForm((f) => ({ ...f, [key]: value }));
    const updateIB = (key: keyof typeof form.investmentBreakdown, value: any) =>
        setForm((f) => ({ ...f, investmentBreakdown: { ...f.investmentBreakdown, [key]: value } }));
    const updateWhy = (idx: number, key: 'title' | 'text', value: string) =>
        setForm((f) => ({
            ...f,
            whyInvest: f.whyInvest.map((w, i) => (i === idx ? { ...w, [key]: value } : w)),
        }));
    const updateFeature = (key: string, value: number) =>
        setForm((f) => ({ ...f, features: { ...f.features, [key]: value } }));

    const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file type
        if (file.type !== "application/pdf") {
            toast.error("Please upload a PDF file");
            return;
        }

        // Validate file size (max 5MB)
        const maxSize = 5 * 1024 * 1024; // 5MB
        if (file.size > maxSize) {
            toast.error("File size must be less than 5MB");
            return;
        }

        try {
            // Convert PDF to base64
            const reader = new FileReader();
            reader.onload = () => {
                const base64 = reader.result as string;
                // Remove the data URL prefix (data:application/pdf;base64,)
                const base64Data = base64.split(",")[1];
                setForm((f) => ({ ...f, proofOfOwnership: base64Data }));
                toast.success("Proof of ownership uploaded successfully");
            };
            reader.onerror = () => {
                toast.error("Failed to read file");
            };
            reader.readAsDataURL(file);
        } catch (error) {
            console.error("Error uploading file:", error);
            toast.error("Failed to upload file");
        }
    };

    const detailsLen = useMemo(() => form.descriptionDetails.length, [form.descriptionDetails]);
    const titleLen = useMemo(() => form.title.length, [form.title]);
    const locationLen = useMemo(() => form.location.length, [form.location]);
    const onSubmit = async (e: FormEvent) => {
        e.preventDefault();
        // Build payload matching the Properties interface (except _id which DB creates)
        const payload = {
            title: form.title.trim(),
            location: form.location.trim(),
            priceUSD: Number(form.priceUSD || 0),
            investors: Number(form.investors || 0),
            status: form.status,
            annualisedReturn: form.annualisedReturn.trim(),
            currentValuationUSD: Number(form.currentValuationUSD || 0),
            grossYield: form.grossYield.trim(),
            netYield: form.netYield.trim(),
            investmentBreakdown: {
                purchaseCost: Number(form.investmentBreakdown.purchaseCost || 0),
                transactionCost: Number(form.investmentBreakdown.transactionCost || 0),
                runningCost: Number(form.investmentBreakdown.runningCost || 0),
            },
            whyInvest: (form.whyInvest || [])
                .map((w) => ({ title: w.title.trim(), text: w.text.trim() }))
                .filter((w) => w.title || w.text),
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
            sell: sellConfig, // include shares configuration from modal
            proofOfOwnership: form.proofOfOwnership || undefined, // Include base64 PDF if uploaded
        };

        await handleSubmit(payload);
    };

    return (
        <div className="container mx-auto px-4 py-6">
            <h1 className="text-2xl font-bold mb-4 text-text-primary">Admin: Add Property</h1>

            {/* Status bar */}
            {useMemo(() => {
                const val = ((step1 === "success" ? 1 : step1 === "running" ? 0.5 : 0)
                    + (step2 === "success" ? 1 : step2 === "running" ? 0.5 : 0)) / 2 * 100;
                const show = processing || step1 !== "idle" || step2 !== "idle";
                if (!show) return null;
                const badge = (s: StepStatus) => (
                    <span className={[
                        "px-2 py-0.5 rounded text-xs font-medium",
                        s === "success" ? "badge-success" : s === "running" ? "badge" : s === "error" ? "badge-dark" : "badge-dark"
                    ].join(" ")}>{s.toUpperCase()}</span>
                );
                return (
                    <div className="card-elevated mb-4">
                        <div className="mb-3 text-sm text-text-secondary">Deployment status</div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-sm text-text-primary">{stepLabels[0]}</span>
                                {badge(step1)}
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-sm text-text-primary">{stepLabels[1]}</span>
                                {badge(step2)}
                            </div>
                        </div>
                        <div className="h-2 rounded bg-bg-secondary overflow-hidden">
                            <div className="h-full bg-accent-primary transition-all" style={{ width: `${val}%` }} />
                        </div>
                    </div>
                );
            }, [processing, step1, step2])}

            <form onSubmit={onSubmit} className="space-y-6">
                <div className="rounded-xl border border-border-subtle bg-bg-secondary p-4">
                    <h2 className="text-lg font-semibold mb-3 text-text-primary">Basic Info</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm mb-1 text-text-secondary flex items-center justify-between">
                                <span>Title</span>
                                <span className="text-xs text-text-secondary">{titleLen}/{MAX_TITLE}</span>
                            </label>
                            <input
                                ref={titleRef}
                                className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary"
                                value={form.title}
                                onChange={(e) => updateField("title", e.target.value.slice(0, MAX_TITLE))}
                                placeholder="One Bedroom Apartment in ..."
                                required
                                maxLength={MAX_TITLE}
                            />
                        </div>
                        <div>
                            <label className="block text-sm mb-1 text-text-secondary flex items-center justify-between">
                                <span>Location</span>
                                <span className="text-xs text-text-secondary">{locationLen}/{MAX_LOCATION}</span>
                            </label>
                            <input
                                ref={locationRef}
                                className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary"
                                value={form.location}
                                onChange={(e) => updateField("location", e.target.value.slice(0, MAX_LOCATION))}
                                placeholder="City Center, Location | Apartment"
                                required
                                maxLength={MAX_LOCATION}
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
                                max={100}
                                className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary"
                                ref={investorsRef}
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
                            <label className="block text-sm mb-1 text-text-secondary">Price (USD)</label>
                            <input
                                type="number"
                                min={0}
                                className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary"
                                ref={priceRef}
                                value={form.priceUSD}
                                onChange={(e) => updateField("priceUSD", e.target.value)}
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm mb-1 text-text-secondary">Current Valuation (USD)</label>
                            <input
                                type="number"
                                min={0}
                                className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary"
                                ref={valuationRef}
                                value={form.currentValuationUSD}
                                onChange={(e) => updateField("currentValuationUSD", e.target.value)}
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
                    <h2 className="text-lg font-semibold mb-3 text-text-primary">Investment Breakdown (USD)</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm mb-1 text-text-secondary flex items-center">
                                <span>Purchase Cost</span>
                                <InfoTip text="One-time acquisition fees such as government transfer fee, land registry, DLD, etc." />
                            </label>
                            <input
                                type="number"
                                min={0}
                                className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary"
                                value={form.investmentBreakdown.purchaseCost}
                                ref={purchaseRef}
                                onChange={(e) => updateIB("purchaseCost", e.target.value)}
                                placeholder="e.g. Government fees, transfer fees"
                            />
                        </div>
                        <div>
                            <label className="block text-sm mb-1 text-text-secondary flex items-center">
                                <span>Transaction Cost</span>
                                <InfoTip text="Brokerage, legal fees, due diligence, registration, bank charges." />
                            </label>
                            <input
                                type="number"
                                min={0}
                                className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary"
                                value={form.investmentBreakdown.transactionCost}
                                ref={transactionRef}
                                onChange={(e) => updateIB("transactionCost", e.target.value)}
                                placeholder="e.g. Brokerage, legal, registration"
                            />
                        </div>
                        <div>
                            <label className="block text-sm mb-1 text-text-secondary flex items-center">
                                <span>Running Cost</span>
                                <InfoTip text="Recurring costs such as maintenance, service charges, utilities, property management." />
                            </label>
                            <input
                                type="number"
                                min={0}
                                className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary"
                                value={form.investmentBreakdown.runningCost}
                                ref={runningRef}
                                onChange={(e) => updateIB("runningCost", e.target.value)}
                                placeholder="e.g. Maintenance, service charges"
                            />
                        </div>
                    </div>
                </div>

                {/* Why invest? editor */}
                <div className="rounded-xl border border-border-subtle bg-bg-secondary p-4">
                    <h2 className="text-lg font-semibold mb-3 text-text-primary">Why invest in this property?</h2>
                    <div className="space-y-4">
                        {(form.whyInvest || []).map((w, idx) => (
                            <div key={idx} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-start">
                                <div className="md:col-span-2">
                                    <label className="block text-sm mb-1 text-text-secondary flex items-center justify-between">
                                        <span>Title</span>
                                        <span className="text-xs text-text-secondary">{(w.title || '').length}/{MAX_WHY_TITLE}</span>
                                    </label>
                                    <input
                                        className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary"
                                        ref={(el) => { whyTitleRefs.current[idx] = el; }}
                                        value={w.title}
                                        onChange={(e) => updateWhy(idx, 'title', e.target.value.slice(0, MAX_WHY_TITLE))}
                                        placeholder="e.g. Strong rental appeal"
                                    />
                                </div>
                                <div className="md:col-span-3">
                                    <label className="block text-sm mb-1 text-text-secondary flex items-center justify-between">
                                        <span>Text</span>
                                        <span className="text-xs text-text-secondary">{(w.text || '').length}/{MAX_WHY_TEXT}</span>
                                    </label>
                                    <textarea
                                        className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary h-24"
                                        ref={(el) => { whyTextRefs.current[idx] = el; }}
                                        value={w.text}
                                        onChange={(e) => updateWhy(idx, 'text', e.target.value.slice(0, MAX_WHY_TEXT))}
                                        placeholder="Explain the key benefit for investors"
                                    />
                                </div>
                                <div className="md:col-span-5 flex justify-end">
                                    <button
                                        type="button"
                                        className="px-3 py-2 rounded border border-border-subtle bg-bg-secondary text-text-primary text-sm hover:cursor-pointer"
                                        onClick={() => setForm(f => ({ ...f, whyInvest: f.whyInvest.filter((_, i) => i !== idx) }))}
                                        disabled={(form.whyInvest || []).length <= 1}
                                    >
                                        Remove
                                    </button>
                                </div>
                            </div>
                        ))}
                        <div>
                            <button
                                type="button"
                                className="px-4 py-2 rounded-lg border border-border-subtle bg-bg-primary text-text-primary text-sm btn-glow"
                                onClick={() => setForm(f => ({ ...f, whyInvest: [...(f.whyInvest || []), { title: "", text: "" }] }))}
                            >
                                Add reason
                            </button>
                        </div>
                    </div>
                </div>

                <div className="rounded-xl border border-border-subtle bg-bg-secondary p-4">
                    <h2 className="text-lg font-semibold mb-3 text-text-primary">Description</h2>
                    <div className="grid grid-cols-1 gap-4">
                        <div>
                            <label className="block text-sm mb-1 text-text-secondary flex items-center justify-between">
                                <span>Details</span>
                                <span className="text-xs text-text-secondary">{detailsLen}/{MAX_DETAILS}</span>
                            </label>
                            <textarea
                                className="w-full px-3 py-2 rounded border border-border-subtle bg-bg-primary text-text-primary h-28"
                                ref={detailsRef}
                                value={form.descriptionDetails}
                                onChange={(e) => updateField("descriptionDetails", e.target.value.slice(0, MAX_DETAILS))}
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

                {/* Shares to sell configuration */}
                <div className="rounded-xl border border-border-subtle bg-bg-secondary p-4">
                    <h2 className="text-lg font-semibold mb-3 text-text-primary">Tokenization / Shares</h2>
                    <div className="flex items-center justify-between gap-4">
                        <div className="text-sm text-text-secondary">
                            Offering {Number(sellConfig.percentToSell || 0).toFixed(0)}% ownership (1 token = 1%).
                        </div>
                        <button
                            type="button"
                            className="px-4 py-2 rounded-lg border border-border-subtle bg-bg-primary text-text-primary text-sm btn-glow"
                            onClick={() => setSellOpen(true)}
                        >
                            Configure percent to sell
                        </button>
                    </div>
                </div>

                {/* Proof of Ownership Upload */}
                <div className="rounded-xl border border-border-subtle bg-bg-secondary p-4">
                    <h2 className="text-lg font-semibold mb-3 text-text-primary">Proof of Ownership</h2>
                    <div className="space-y-3">
                        <div className="text-sm text-text-secondary">
                            Upload a PDF document proving ownership of the property (e.g., title deed, ownership certificate).
                        </div>
                        <div className="flex items-center gap-4">
                            <label className="px-4 py-2 rounded-lg border border-border-subtle bg-bg-primary text-text-primary text-sm btn-glow hover:cursor-pointer inline-block">
                                <input
                                    type="file"
                                    accept="application/pdf"
                                    onChange={handlePdfUpload}
                                    className="hidden"
                                />
                                Choose PDF File
                            </label>
                            {form.proofOfOwnership && (
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-green-400">✓ Document uploaded</span>
                                    <button
                                        type="button"
                                        className="text-sm text-red-400 hover:text-red-300"
                                        onClick={() => setForm(f => ({ ...f, proofOfOwnership: "" }))}
                                    >
                                        Remove
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className="text-xs text-text-secondary">
                            Max file size: 5MB. File will be securely stored as base64 encoded data.
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-between gap-4">
                    <div className="text-xs md:text-sm text-red-400">
                        Disclaimer: This is a demo app, please do not try to sell your actual real estate.
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="submit"
                            className="px-4 py-2 rounded-lg bg-accent-primary text-white hover:bg-accent-hover hover:cursor-pointer transition-colors text-sm btn-glow border border-transparent disabled:opacity-60 disabled:cursor-not-allowed"
                            disabled={processing}
                        >
                            Submit
                        </button>
                    </div>
                </div>
            </form>

            <SellSharesModal
                isOpen={isSellOpen}
                onClose={() => setSellOpen(false)}
                initial={sellConfig}
                onSubmit={(cfg) => {
                    setSellConfig(cfg);
                    setSellOpen(false);
                }}
            />
        </div>
    );
}