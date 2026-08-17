import { Router, type Request, type Response } from 'express';
import { Hash, Utils, LockingScript, OP, PublicKey, Transaction, SatoshisPerKilobyte } from '@bsv/sdk';
import { connectToMongo, propertiesCollection, propertyDescriptionsCollection } from '../lib/mongo';
import type { Properties } from '../lib/mongo';
import { toOutpoint } from '@shared/bsv/outpoints';
import { OrdinalsP2MS } from '@shared/bsv/ordinalsP2MS';
import { PaymentUtxo } from '@shared/bsv/paymentUtxo';
import { hashFromPubkeys } from '@shared/bsv/hashFromPubkeys';
import { broadcastTX } from '@shared/overlay';
import { generateNonce, deriveMultisigPair, getIdentityKey, TOKEN_PROTOCOL } from '@shared/bsv/tokenDerivation';
import { internalizeToBasket } from '@shared/bsv/internalizeToBasket';
import { encodeBeef } from '@shared/bsv/beefEncoding';
import { logger } from '@shared/logger';
import { getWalletQueue } from '../lib/walletQueue';
import { requireSession } from '../middleware/requireSession';
import { requireAuthProof } from '../middleware/requireAuthProof';
import { AUTH_PROOF_PURPOSE } from '@shared/authProofPurposes';

export const tokenizeRouter = Router();

/**
 * POST /api/tokenize/create-property — mint a property token + its shares.
 *
 * Ported verbatim from src/app/api/tokenize/create-property/route.ts.
 *
 * THE critical route of this migration: the two createAction calls and the
 * signAction all run inside ONE queue.enqueue() so no other request can select
 * UTXOs between them. Splitting them across enqueues re-opens the double-spend
 * race this migration exists to close. Never call enqueue() (or
 * getWalletQueue()) from inside the callback — that deadlocks the queue
 * permanently; the wallet arrives as the callback parameter.
 *
 * Guard: requireSession (login) AND requireAuthProof(AUTH_PROOF_PURPOSE.createProperty)
 * — a single-use signed proof bound to this action. The Next source was session-only;
 * the proof is a deliberate Task 12 defence-in-depth addition, not a port artifact —
 * do not remove it to "restore fidelity" with the source.
 */
tokenizeRouter.post(
    '/create-property',
    requireSession,
    requireAuthProof(AUTH_PROOF_PURPOSE.createProperty),
    async (req: Request, res: Response) => {
        logger.debug('[TIMING] ===== TOKENIZE ROUTE START =====');
        const routeStart = Date.now();
        const userId = req.userId as string;
        const { data, paymentTxAction, paymentNonce, seller } = req.body;

        // Identity check: token user must match seller
        if (seller !== userId) {
            res.status(403).json({ error: "You can't tokenize a property for another user" });
            return;
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
                res.status(400).json({ error: "Validation failed", details: errors });
                return;
            }
        } catch { }

        const nullFields = Object.entries(data)
            .filter(([_, value]) => value === null)
            .map(([key]) => key);

        if (nullFields.length > 0) {
            res.status(400).json({ error: `Missing required fields: ${nullFields.join(', ')}` });
            return;
        }

        // Post-enqueue result, hoisted above the try so the catch block can tell
        // whether the mint already landed on-chain before a later step threw.
        let minted: {
            propertyTokenTxid: string;
            mintNonce: string;
            serverIdentityKey: string;
            serverChild: string;
            sellerChild: string;
            changePaymentNonce: string;
            sellerChangeChild: string;
            signedActionTxid: string;
            atomicBeef: number[];
        } | undefined;
        try {
            logger.debug('[TIMING] Starting MongoDB connection...');
            const mongoStart = Date.now();
            await connectToMongo();
            logger.debug(`[TIMING] MongoDB connected in ${Date.now() - mongoStart}ms`);

            logger.debug('[TIMING] Starting wallet creation...');
            const walletStart = Date.now();

            // ---------------------------------------------------------------
            // ONE enqueue for BOTH createActions AND the signAction (plus the
            // internalizeAction that files the minted output). Everything that
            // touches the server wallet's UTXO set lives in here.
            // ---------------------------------------------------------------
            const queue = await getWalletQueue();
            minted = await queue.enqueue('tokenize:create-property', async (wallet) => {
                if (!wallet) {
                    throw new Error("Failed to create wallet");
                }
                logger.debug(`[TIMING] Wallet created in ${Date.now() - walletStart}ms`);

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

                logger.debug('[TIMING] Starting property token createAction...');
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
                        // No acceptDelayedBroadcast needed - this output is just a reference token, not spent immediately
                    }
                });
                logger.debug(`[TIMING] Property token createAction completed in ${Date.now() - createPropertyStart}ms`);

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

                // Create the ordinal locking script with 1sat inscription (derived keys)
                const serverIdentityKey = await getIdentityKey(wallet);
                const mintNonce = generateNonce();
                // builder is the server; counterparty/party is the seller
                const { selfKey: serverChild, counterpartyKey: sellerChild } = await deriveMultisigPair(wallet, seller, mintNonce);
                // committed order: [seller, server]  => server is self-second
                const hashOfPubkeys = hashFromPubkeys([PublicKey.fromString(sellerChild), PublicKey.fromString(serverChild)]);
                const ordinalLockingScript = new OrdinalsP2MS().lock(
                    /* oneOfTwoHash */ hashOfPubkeys,
                    /* assetId */ `${response.txid}_0`,
                    /* tokenTxid */ propertyTokenTxid,
                    /* shares */ tokensToMint,
                    /* type */ "deploy+mint"
                );

                // Payment CHANGE: derived 1-of-2 multisig (server + seller) at a fresh nonce.
                // Committed order [seller, server] => server is self-second on its next spend.
                const changePaymentNonce = generateNonce();
                const { selfKey: serverChangeChild, counterpartyKey: sellerChangeChild } = await deriveMultisigPair(wallet, seller, changePaymentNonce);
                const oneOfTwoHash = hashFromPubkeys([PublicKey.fromString(sellerChangeChild), PublicKey.fromString(serverChangeChild)]);
                const paymentChangeLockingScript = new PaymentUtxo().lock(/* oneOfTwoHash */ oneOfTwoHash);

                // Parse payment transaction
                if (!paymentTxAction?.txid) {
                    throw new Error("Invalid payment transaction");
                }

                const paymentSourceTX = Transaction.fromBEEF(paymentTxAction.tx as number[]);

                // Spend the client-locked prefund payment via its derived key.
                // Client locked [userChild, serverChild] (user first) => server is self-second (firstPubkeyIsWallet=false).
                const { counterpartyKey: userPaymentChild } = await deriveMultisigPair(wallet, seller, paymentNonce);
                // Create payment unlock frame (used for both preimage and final signing)
                const paymentUnlockFrame = new PaymentUtxo().unlock(
                    /* wallet */ wallet,
                    /* keyID */ paymentNonce,
                    /* counterparty */ seller,
                    /* otherPubkey */ userPaymentChild,
                    /* signOutputs */ "all",
                    /* anyoneCanPay */ false,
                    /* sourceSatoshis */ undefined,
                    /* lockingScript */ undefined,
                    /* firstPubkeyIsWallet */ false, // order: user first, then server
                    /* protocolID */ TOKEN_PROTOCOL,
                );

                // Build preimage for payment input to calculate change satoshis
                logger.debug('[TIMING] Starting preimage transaction build and sign...');
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
                logger.debug(`[TIMING] Preimage transaction completed in ${Date.now() - preimageStart}ms`);

                const changeSats = preimageTx.outputs[1].satoshis as number
                logger.debug(`[TIMING] Calculated change satoshis: ${changeSats}`);

                // Create the mint transaction with unlockingScriptLength instead of actual unlocking script
                logger.debug('[TIMING] Starting mint createAction with unlockingScriptLength...');
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
                        acceptDelayedBroadcast: false,
                    }
                });
                logger.debug(`[TIMING] Mint createAction completed in ${Date.now() - createActionStart}ms`);

                if (!actionRes?.signableTransaction) {
                    throw new Error("Failed to create signable transaction");
                }

                const reference = actionRes.signableTransaction.reference;
                const txToSign = Transaction.fromBEEF(actionRes.signableTransaction.tx);

                // Add unlocking script template to the payment input (reuse same frame)
                logger.debug('[TIMING] Starting final transaction signing...');
                const finalSignStart = Date.now();
                txToSign.inputs[0].unlockingScriptTemplate = paymentUnlockFrame;
                txToSign.inputs[0].sourceTransaction = paymentSourceTX;

                // Sign the complete transaction
                await txToSign.sign();
                logger.debug(`[TIMING] Final transaction sign completed in ${Date.now() - finalSignStart}ms`);

                // Extract the unlocking script
                const unlockingScript = txToSign.inputs[0].unlockingScript?.toHex();
                if (!unlockingScript) {
                    throw new Error("Missing unlocking script for payment input");
                }

                // Sign the action with the actual unlocking script
                logger.debug('[TIMING] Starting signAction...');
                const signActionStart = Date.now();
                const signedAction = await wallet.signAction({
                    reference,
                    spends: {
                        "0": { unlockingScript }
                    }
                });
                logger.debug(`[TIMING] signAction completed in ${Date.now() - signActionStart}ms`);

                if (!signedAction?.txid) {
                    throw new Error("Failed to mint shares for property token");
                }

                // Internalize the mint output (index 0) into the server basket
                const atomicBeef = signedAction.tx as number[];
                await internalizeToBasket(wallet, atomicBeef, [{
                    outputIndex: 0, keyId: mintNonce, counterparty: seller,
                    counterpartyDerivedKey: sellerChild, order: 'self-second', tags: ['type:share'],
                }], "Mint shares (server side)");

                return {
                    propertyTokenTxid,
                    mintNonce,
                    serverIdentityKey,
                    serverChild,
                    sellerChild,
                    changePaymentNonce,
                    sellerChangeChild,
                    signedActionTxid: signedAction.txid,
                    atomicBeef,
                };
            });
            // ---------------------------------------------------------------
            // End of the wallet-serialized region.
            // ---------------------------------------------------------------

            const {
                propertyTokenTxid, mintNonce, serverIdentityKey, serverChild, sellerChild,
                changePaymentNonce, sellerChangeChild, signedActionTxid, atomicBeef,
            } = minted;

            // Broadcast the mint transaction to the Overlay.
            // SANCTIONED CHANGE vs the Next route: this runs AFTER res.json and
            // OUTSIDE the queue. signAction already broadcast to chain
            // (acceptDelayedBroadcast: false), so the overlay push is
            // best-effort indexing and must not hold the queue or the client.
            // The whole chain — including the BEEF decode — is .catch()-wrapped:
            // an unhandled rejection after res.json would kill this single
            // process and with it the entire API.
            const pushToOverlay = (): void => {
                void Promise.resolve()
                    .then(async () => {
                        logger.debug('[TIMING] Starting overlay broadcast...');
                        const broadcastStart = Date.now();
                        const mintTx = Transaction.fromBEEF(atomicBeef);
                        // txid derived locally, never taken from the broadcast result
                        const mintTxid = mintTx.id('hex');
                        const overlayResponse = await broadcastTX(mintTx);
                        logger.debug(`[TIMING] Overlay broadcast completed in ${Date.now() - broadcastStart}ms`);

                        if (overlayResponse.status !== "success") {
                            logger.debug(`Failed to broadcast transaction for ${mintTxid}`);
                        }
                    })
                    .catch((e) => {
                        logger.error('[tokenize:create-property] overlay broadcast failed (non-blocking):', e);
                    });
            };

            // Save property data to database
            logger.debug('[TIMING] Starting database operations...');
            const dbStart = Date.now();
            const { description, whyInvest, ...rest } = data || {};

            const mintOutpoint = toOutpoint(signedActionTxid, 0);
            const formattedPropertyData: Properties = {
                ...rest,
                txids: {
                    tokenTxid: propertyTokenTxid,
                    originalMintTxid: mintOutpoint,
                    currentOutpoint: mintOutpoint,
                    paymentTxid: toOutpoint(signedActionTxid, 1),
                },
                currentDerivation: {
                    keyId: mintNonce,
                    counterparty: seller,
                    counterpartyDerivedKey: sellerChild,
                    order: 'self-second',
                    beef: encodeBeef(atomicBeef),
                },
                paymentDerivation: {
                    keyId: changePaymentNonce,
                    counterparty: seller,
                    counterpartyDerivedKey: sellerChangeChild,
                    order: 'self-second',
                },
                seller,
            };

            // Save property core document
            const propertyInsert = await propertiesCollection.insertOne(formattedPropertyData);
            if (!propertyInsert.acknowledged) {
                res.status(500).json({ error: "Failed to save property, please try again" });
                pushToOverlay(); // the mint exists on-chain regardless; still index it
                return;
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
                logger.warn("Failed to insert property description:", e);
            }

            logger.debug(`[TIMING] Database operations completed in ${Date.now() - dbStart}ms`);
            logger.debug(`[TIMING] ===== TOTAL ROUTE TIME: ${Date.now() - routeStart}ms =====`);

            res.json({
                success: true, status: 200, data: propertyInsert,
                received: {
                    atomicBeef: encodeBeef(atomicBeef), outputIndex: 0, keyId: mintNonce,
                    counterparty: serverIdentityKey, counterpartyDerivedKey: serverChild, order: 'self-first'
                },
            });

            pushToOverlay();
        } catch (e) {
            logger.error(e);
            res.status(500).json({ error: "Internal server error" });
            if (minted) {
                // signAction already broadcast this mint to chain; a post-enqueue
                // failure (e.g. a thrown, not just unacknowledged, DB insert) must
                // not skip the only indexing path. Guaranteed not to double-push:
                // this catch block and the try block's own paths (the explicit
                // !acknowledged branch at :437ish, which already pushes and
                // returns, and the success path, which pushes after res.json)
                // are all mutually exclusive — only one of them executes per
                // request, since each either returns or throws.
                const { atomicBeef } = minted;
                void Promise.resolve()
                    .then(async () => {
                        const mintTx = Transaction.fromBEEF(atomicBeef);
                        const mintTxid = mintTx.id('hex');
                        const overlayResponse = await broadcastTX(mintTx);

                        if (overlayResponse.status !== "success") {
                            logger.debug(`Failed to broadcast transaction for ${mintTxid}`);
                        }
                    })
                    .catch((e2) => {
                        logger.error('[tokenize:create-property] overlay broadcast failed (non-blocking):', e2);
                    });
            }
        }
    },
);
