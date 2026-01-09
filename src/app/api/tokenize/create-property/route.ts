import { connectToMongo, propertiesCollection, propertyDescriptionsCollection } from "../../../../lib/mongo";
import { NextResponse } from "next/server";
import { Properties } from "../../../../lib/mongo";
import { toOutpoint } from "../../../../utils/outpoints";
import { requireAuth } from "../../../../utils/apiAuth";
import { makeWallet } from "../../../../lib/serverWallet";
import { Hash, Utils, LockingScript, OP, PublicKey, UnlockingScript, Transaction, SatoshisPerKilobyte } from "@bsv/sdk";
import { OrdinalsP2MS } from "../../../../utils/ordinalsP2MS";
import { PaymentUtxo } from "../../../../utils/paymentUtxo";
import { hashFromPubkeys } from "../../../../utils/hashFromPubkeys";
import { broadcastTX } from "../../../../hooks/overlayFunctions";

const STORAGE_URL = process.env.STORAGE_URL;
const SERVER_PRIVATE_KEY = process.env.SERVER_PRIVATE_KEY;

export async function POST(request: Request) {
    console.log('[TIMING] ===== TOKENIZE ROUTE START =====');
    const routeStart = Date.now();
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const userId = auth.user;
    const { data, paymentTxAction, seller } = await request.json();

    // Identity check: token user must match seller
    if (seller !== userId) {
        return NextResponse.json({ error: "You can't tokenize a property for another user" }, { status: 403 });
    }

    // Enforce server-side limits (must match validators.ts)
    const MAX_DETAILS = 1500;
    const MAX_WHY_TITLE = 80;
    const MAX_WHY_TEXT = 400;
    const MAX_TITLE = 80;
    const MAX_LOCATION = 80;
    const MAX_PROOF_OF_OWNERSHIP = 10485760; // 10MB base64 limit
    try {
        const { description, whyInvest, title, location, proofOfOwnership } = data || {};
        const errors: string[] = [];
        // Title & Location
        const t = String(title ?? "").trim();
        const loc = String(location ?? "").trim();
        if (!loc) errors.push("location is required");
        if (t.length > MAX_TITLE) errors.push(`title too long (${t.length}/${MAX_TITLE})`);
        if (loc.length > MAX_LOCATION) errors.push(`location too long (${loc.length}/${MAX_LOCATION})`);
        // Textual limits
        const detailsLen = (description?.details || "").length;
        if (detailsLen > MAX_DETAILS) {
            errors.push(`Description details too long (${detailsLen}/${MAX_DETAILS})`);
        }
        if (Array.isArray(whyInvest)) {
            whyInvest.forEach((w: any, idx: number) => {
                const tlen = String(w?.title || "").length;
                const xlen = String(w?.text || "").length;
                if (tlen > MAX_WHY_TITLE) errors.push(`whyInvest[${idx}].title too long (${tlen}/${MAX_WHY_TITLE})`);
                if (xlen > MAX_WHY_TEXT) errors.push(`whyInvest[${idx}].text too long (${xlen}/${MAX_WHY_TEXT})`);
            });
        }
        // Validate proof of ownership if provided
        if (proofOfOwnership) {
            if (typeof proofOfOwnership !== 'string') {
                errors.push('proofOfOwnership must be a base64 string');
            } else if (proofOfOwnership.length > MAX_PROOF_OF_OWNERSHIP) {
                errors.push(`proofOfOwnership too large (${proofOfOwnership.length}/${MAX_PROOF_OF_OWNERSHIP} chars)`);
            } else {
                // Validate base64 format
                const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
                if (!base64Regex.test(proofOfOwnership)) {
                    errors.push('proofOfOwnership must be valid base64');
                }
            }
        }

        // Numeric sanity checks (avoid pathological values)
        const MAX_CURRENCY = 1e12; // USD cap ~ 1 trillion
        const MAX_INVESTORS = 1e7; // 10 million investors cap
        const isValidCurrency = (n: any) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= MAX_CURRENCY;
        const isValidInteger = (n: any) => Number.isInteger(n) && n >= 0;

        const currencyChecks: Array<[string, any]> = [
            ["priceUSD", data?.priceUSD],
            ["currentValuationUSD", data?.currentValuationUSD],
            ["investmentBreakdown.purchaseCost", data?.investmentBreakdown?.purchaseCost],
            ["investmentBreakdown.transactionCost", data?.investmentBreakdown?.transactionCost],
            ["investmentBreakdown.runningCost", data?.investmentBreakdown?.runningCost],
        ];
        currencyChecks.forEach(([name, value]) => {
            if (value != null && !isValidCurrency(value)) {
                errors.push(`${name} must be a finite, non-negative number <= ${MAX_CURRENCY}`);
            }
        });
        if (data?.investors != null) {
            if (!isValidInteger(data.investors) || data.investors > MAX_INVESTORS) {
                errors.push(`investors must be a non-negative integer <= ${MAX_INVESTORS}`);
            }
        }
        if (errors.length > 0) {
            return NextResponse.json({ error: "Validation failed", details: errors }, { status: 400 });
        }
    } catch {}

    const nullFields = Object.entries(data)
        .filter(([_, value]) => value === null)
        .map(([key]) => key);

    if (nullFields.length > 0) {
        return NextResponse.json({ error: `Missing required fields: ${nullFields.join(', ')}` }, { status: 400 });
    }

    try {
        console.log('[TIMING] Starting MongoDB connection...');
        const mongoStart = Date.now();
        await connectToMongo();
        console.log(`[TIMING] MongoDB connected in ${Date.now() - mongoStart}ms`);

        if (!SERVER_PRIVATE_KEY || !STORAGE_URL) {
            return NextResponse.json({ error: "Server wallet not configured" }, { status: 500 });
        }

        console.log('[TIMING] Starting wallet creation...');
        const walletStart = Date.now();
        const wallet = await makeWallet("main", STORAGE_URL as string, SERVER_PRIVATE_KEY as string);
        if (!wallet) {
            throw new Error("Failed to create wallet");
        }
        console.log(`[TIMING] Wallet created in ${Date.now() - walletStart}ms`);

        // Get server public key
        console.log('[TIMING] Getting server public key...');
        const pubKeyStart = Date.now();
        const { publicKey: serverPubKey } = await wallet.getPublicKey({
            protocolID: [0, "fractionalized"],
            keyID: "0",
        });
        console.log(`[TIMING] Got server public key in ${Date.now() - pubKeyStart}ms`);

        // Create property token using server wallet but with user's pubKeyHash
        const title = data.title.trim().toLowerCase();
        const location = data.location.trim().toLowerCase();
        const currentDate = new Date().toISOString();
        const propertyDataHash = Hash.hash256(
            Utils.toArray(`${title}-${location}-${currentDate}`, "utf8")
        );

        // Use seller's (user's) pubKeyHash since they are the property owner
        const pubKeyHash = Hash.hash160(seller, "hex") as number[];
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

        console.log('[TIMING] Starting property token createAction...');
        const createPropertyStart = Date.now();
        const response = await wallet.createAction({
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
        console.log(`[TIMING] Property token createAction completed in ${Date.now() - createPropertyStart}ms`);

        if (!response?.txid) {
            throw new Error("Failed to create property token");
        }

        const propertyTokenTxid = toOutpoint(response.txid, 0);

        // Mint shares for property token using server wallet
        const tokensToMint = Number(data?.sell?.percentToSell || 0);
        if (tokensToMint <= 0) {
            throw new Error("Invalid percentToSell");
        } else if (tokensToMint > 100) {
            throw new Error("Percent to sell must be less than or equal to 100");
        }

        // Create the ordinal locking script with 1sat inscription
        const hashOfPubkeys = hashFromPubkeys([PublicKey.fromString(seller), PublicKey.fromString(serverPubKey)])
        const ordinalLockingScript = new OrdinalsP2MS().lock(
            /* oneOfTwoHash */ hashOfPubkeys,
            /* assetId */ `${response.txid}_0`,
            /* tokenTxid */ propertyTokenTxid,
            /* shares */ tokensToMint,
            /* type */ "deploy+mint"
        );

        // Create payment change locking script (multisig 1 of 2 so server can use funds for transfer fees)
        const oneOfTwoHash = hashFromPubkeys([PublicKey.fromString(serverPubKey), PublicKey.fromString(seller)]);
        const paymentChangeLockingScript = new PaymentUtxo().lock(/* oneOfTwoHash */ oneOfTwoHash);

        // Parse payment transaction
        if (!paymentTxAction?.txid) {
            throw new Error("Invalid payment transaction");
        }

        const paymentSourceTX = Transaction.fromBEEF(paymentTxAction.tx as number[]);

        // Create payment unlock frame (used for both preimage and final signing)
        const paymentUnlockFrame = new PaymentUtxo().unlock(
            /* wallet */ wallet,
            /* otherPubkey */ seller,
            /* signOutputs */ "all",
            /* anyoneCanPay */ false,
            /* sourceSatoshis */ undefined,
            /* lockingScript */ undefined,
            /* firstPubkeyIsWallet */ true // order: server first, then user
        );

        // Build preimage for payment input to calculate change satoshis
        console.log('[TIMING] Starting preimage transaction build and sign...');
        const preimageStart = Date.now();
        const preimageTx = new Transaction();
        preimageTx.addInput({
            sourceTransaction: paymentSourceTX,
            unlockingScriptTemplate: paymentUnlockFrame,
            sourceOutputIndex: 0,
        });
        preimageTx.addOutput({
            satoshis: 1,
            lockingScript: ordinalLockingScript,
        });
        preimageTx.addOutput({
            change: true,
            lockingScript: paymentChangeLockingScript,
        });

        await preimageTx.fee(new SatoshisPerKilobyte(100))
        await preimageTx.sign()
        console.log(`[TIMING] Preimage transaction completed in ${Date.now() - preimageStart}ms`);

        const changeSats = preimageTx.outputs[1].satoshis as number
        console.log(`[TIMING] Calculated change satoshis: ${changeSats}`);

        // Create the mint transaction with unlockingScriptLength instead of actual unlocking script
        console.log('[TIMING] Starting mint createAction with unlockingScriptLength...');
        const createActionStart = Date.now();
        const actionRes = await wallet.createAction({
            description: "Mint shares for property token",
            inputBEEF: paymentTxAction?.tx,
            inputs: [
                {
                    inputDescription: "Payment",
                    outpoint: toOutpoint(String(paymentTxAction?.txid), 0),
                    unlockingScriptLength: 142, // PaymentUtxo estimateLength
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
        console.log(`[TIMING] Mint createAction completed in ${Date.now() - createActionStart}ms`);

        if (!actionRes?.signableTransaction) {
            throw new Error("Failed to create signable transaction");
        }

        const reference = actionRes.signableTransaction.reference;
        const txToSign = Transaction.fromBEEF(actionRes.signableTransaction.tx);

        // Add unlocking script template to the payment input (reuse same frame)
        console.log('[TIMING] Starting final transaction signing...');
        const finalSignStart = Date.now();
        txToSign.inputs[0].unlockingScriptTemplate = paymentUnlockFrame;
        txToSign.inputs[0].sourceTransaction = paymentSourceTX;

        // Sign the complete transaction
        await txToSign.sign();
        console.log(`[TIMING] Final transaction sign completed in ${Date.now() - finalSignStart}ms`);

        // Extract the unlocking script
        const unlockingScript = txToSign.inputs[0].unlockingScript?.toHex();
        if (!unlockingScript) {
            throw new Error("Missing unlocking script for payment input");
        }

        // Sign the action with the actual unlocking script
        console.log('[TIMING] Starting signAction...');
        const signActionStart = Date.now();
        const signedAction = await wallet.signAction({
            reference,
            spends: {
                "0": { unlockingScript }
            }
        });
        console.log(`[TIMING] signAction completed in ${Date.now() - signActionStart}ms`);

        if (!signedAction?.txid) {
            throw new Error("Failed to mint shares for property token");
        }

        // Broadcast the mint transaction to the Overlay
        console.log('[TIMING] Starting overlay broadcast...');
        const broadcastStart = Date.now();
        const mintTx = Transaction.fromBEEF(signedAction.tx as number[]);
        const overlayResponse = await broadcastTX(mintTx);
        console.log(`[TIMING] Overlay broadcast completed in ${Date.now() - broadcastStart}ms`);

        if (overlayResponse.status !== "success") {
            console.log(`Failed to broadcast transaction for ${signedAction.txid}`);
        }

        // Save property data to database
        console.log('[TIMING] Starting database operations...');
        const dbStart = Date.now();
        const { description, whyInvest, ...rest } = data || {};

        const mintOutpoint = toOutpoint(signedAction.txid, 0);
        const formattedPropertyData: Properties = {
            ...rest,
            txids: {
                tokenTxid: propertyTokenTxid,
                originalMintTxid: mintOutpoint,
                currentOutpoint: mintOutpoint,
                paymentTxid: toOutpoint(signedAction.txid, 1),
                mintTxid: mintOutpoint, // For backward compatibility
            },
            seller,
        };

        // Save property core document
        const propertyInsert = await propertiesCollection.insertOne(formattedPropertyData);
        if (!propertyInsert.acknowledged) {
            return NextResponse.json({ error: "Failed to save property, please try again" }, { status: 500 });
        }

        // Save extended description in separate collection (optional, only if provided)
        try {
            if (description || (whyInvest && Array.isArray(whyInvest))) {
                await propertyDescriptionsCollection.insertOne({
                    propertyId: propertyInsert.insertedId,
                    description: {
                        details: description?.details || "",
                        features: Array.isArray(description?.features) ? description.features : [],
                    },
                    whyInvest: Array.isArray(whyInvest)
                        ? whyInvest.map((w: any) => ({ title: String(w?.title || ""), text: String(w?.text || "") }))
                        : undefined,
                });
            }
        } catch (e) {
            // If the description insert fails, we won't fail the whole operation; log and proceed
            console.warn("Failed to insert property description:", e);
        }

        console.log(`[TIMING] Database operations completed in ${Date.now() - dbStart}ms`);
        console.log(`[TIMING] ===== TOTAL ROUTE TIME: ${Date.now() - routeStart}ms =====`);

        return NextResponse.json({ success: true, status: 200, data: propertyInsert });
    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
