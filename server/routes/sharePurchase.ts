import { Router, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { Beef, Hash, PublicKey, SatoshisPerKilobyte, Transaction, UnlockingScript } from '@bsv/sdk';
import { connectToMongo, propertiesCollection, sharesCollection, locksCollection } from '../../src/lib/mongo';
import type { Shares } from '../../src/lib/mongo';
import { OrdinalsP2PKH } from '../../src/utils/ordinalsP2PKH';
import { OrdinalsP2MS } from '../../src/utils/ordinalsP2MS';
import { broadcastTX, getTransactionByTxID } from '../../src/hooks/overlayFunctions';
import { calcTokenTransfer } from '../../src/hooks/calcTokenTransfer';
import { PaymentUtxo } from '../../src/utils/paymentUtxo';
import { parseOutpoint, toOutpoint } from '../../src/utils/outpoints';
import { hashFromPubkeys } from '../../src/utils/hashFromPubkeys';
import { generateNonce, deriveMultisigPair, deriveRecipientKey, getIdentityKey, TOKEN_PROTOCOL } from '../../src/utils/tokenDerivation';
import { internalizeToBasket } from '../../src/utils/internalizeToBasket';
import { encodeBeef } from '../../src/utils/beefEncoding';
import { fetchTokenSourceTx } from '../../src/utils/fetchTokenSourceTx';
import { logger } from '../../src/utils/logger';
import { getWalletQueue } from '../lib/walletQueue';
import { getServerWallet } from '../lib/serverWallet';
import { requireSession } from '../middleware/requireSession';
import { requireAuthProof } from '../middleware/requireAuthProof';
import { AUTH_PROOF_PURPOSE } from '../../src/lib/authProofPurposes';

export const sharePurchaseRouter = Router();

/**
 * POST /api/share-purchase — transfer a percentage of a property's shares
 * from the current ordinal holder to an investor.
 *
 * Ported verbatim from src/app/api/share-purchase/route.ts.
 *
 * THE critical route of this migration alongside tokenize: createAction,
 * signAction, and the internalizeAction that files the ordinal change both
 * run inside ONE queue.enqueue() so no other request can select UTXOs
 * between them. Everything before the enqueue — validation, the Mongo
 * advisory lock, DB reads, and the overlay parent-tx fetch — is network I/O
 * and must NOT hold the wallet lock, or every purchase would serialize
 * behind an overlay round-trip. Never call enqueue() (or getWalletQueue())
 * from inside the callback — that deadlocks the queue permanently; the
 * wallet arrives as the callback parameter. Key-derivation and preimage
 * signing (generateNonce/deriveMultisigPair/deriveRecipientKey/getIdentityKey
 * and the unlock-frame .sign() calls used to build the preimage) don't touch
 * the wallet's UTXO set, so they run outside the enqueue via the shared
 * getServerWallet() wallet — the same underlying wallet instance the queue
 * wraps.
 *
 * Guard: requireSession (login) AND requireAuthProof(AUTH_PROOF_PURPOSE.sharePurchase)
 * — a single-use signed proof bound to this action. The Next source was session-only;
 * the proof is a deliberate Task 12 defence-in-depth addition, not a port artifact —
 * do not remove it to "restore fidelity" with the source.
 */
sharePurchaseRouter.post(
    '/',
    requireSession,
    requireAuthProof(AUTH_PROOF_PURPOSE.sharePurchase),
    async (req: Request, res: Response) => {
        const userId = req.userId as string;
        const { propertyId, investorId, amount } = req.body;
        logger.debug("InvestorId", investorId)

        // Verify the investoryId (requester) is the logged in user
        if (userId !== investorId) {
            res.status(403).json({ error: "You can't make a purchase for another user" });
            return;
        }

        // Verify the purchase and make a blockchain transaction

        // Transfer 1satOrdinal from the property UTXO to the investor
        let lockId: ObjectId | null = null;
        let transfer: { txid: string; atomicBeef: number[] } | undefined;
        try {
            await connectToMongo();

            const wallet = await getServerWallet();
            if (!wallet) {
                throw new Error("Failed to create wallet");
            }
            const propertyObjectId = new ObjectId(propertyId);
            if (typeof investorId !== "string") {
                res.status(400).json({ error: "Invalid investorId" });
                return;
            }

            if (amount <= 0) {
                res.status(400).json({ error: "Invalid amount" });
                return;
            } else if (amount > 100) {
                res.status(400).json({ error: "Amount must be less than 100%" });
                return;
            } else if (typeof amount !== 'number') {
                res.status(400).json({ error: "Invalid amount" });
                return;
            }

            // Acquire per-(propertyId, investorId) lock; unique index enforces single holder
            try {
                const lockRes = await locksCollection.insertOne({
                    _id: new ObjectId(),
                    propertyId: propertyObjectId,
                    investorId,
                    createdAt: new Date(),
                });
                lockId = lockRes.insertedId;
            } catch (e: any) {
                // Duplicate key error => lock already held
                if (e?.code === 11000) {
                    res.status(409).json({ error: "Another transfer is in progress for this investor and property" });
                    return;
                }
                throw e;
            }

            const property = await propertiesCollection.findOne({ _id: propertyObjectId });
            if (!property) {
                throw new Error("Property not found");
            }
            if (!property?.txids?.currentOutpoint || !property?.txids?.paymentTxid || !property?.txids?.originalMintTxid) {
                throw new Error("Property token UTXOs not initialized");
            }

            // Validate that purchase amount doesn't exceed available shares
            const percentToSell = property?.sell?.percentToSell;
            if (percentToSell != null) {
                // Use stored remainingPercent if available, otherwise calculate it
                let remainingPercent = property?.sell?.remainingPercent;
                if (remainingPercent == null) {
                    const existingShares = await sharesCollection
                        .find({ propertyId: propertyObjectId })
                        .toArray();
                    const totalSold = existingShares.reduce((sum, share) => sum + share.amount, 0);
                    remainingPercent = percentToSell - totalSold;
                }

                // Validate purchase amount against remaining shares
                if (amount > remainingPercent) {
                    res.status(400).json(
                        { error: `Cannot purchase ${amount}% - only ${remainingPercent.toFixed(2)}% remaining` },
                    );
                    return;
                }
            }

            // Get property token txid to put in the inscribed token (for indentification)
            const propertyTokenTxid = property.txids.tokenTxid;

            // Payment unlocking will be signed against the preimage (frame-based)

            // Server's root identity key (counterparty value recipients/parties derive against)
            const serverIdentityKey = await getIdentityKey(wallet);

            // Spend from the current outpoint (either original mint or latest change output)
            const currentOrdinalOutpoint = property.txids.currentOutpoint as string;
            const { txid: parentTxID, vout: parentVout } = parseOutpoint(currentOrdinalOutpoint);

            // Resolve the ordinal source tx via carry-forward BEEF (falls back to overlay inside helper)
            const fullParentTx = await fetchTokenSourceTx(currentOrdinalOutpoint, property.currentDerivation?.beef);

            // Ordinal unlock: recorded type-42 derivation, else legacy.
            const cur = property.currentDerivation;
            const ordinalUnlockingFrame = cur?.keyId
                ? new OrdinalsP2MS().unlock(wallet, cur.keyId, cur.counterparty, cur.counterpartyDerivedKey,
                    "single", true, undefined, undefined, cur.order === 'self-first', TOKEN_PROTOCOL)
                : new OrdinalsP2MS().unlock(wallet, "0", "self", property.seller, "single", true, undefined, undefined, false);

            // Payment unlock: recorded type-42 derivation, else legacy static key.
            // Legacy lock was [server, seller] (server first => firstPubkeyIsWallet=true).
            const pd = property.paymentDerivation;
            const paymentUnlockFrame = pd?.keyId
                ? new PaymentUtxo().unlock(
                    /* wallet */ wallet,
                    /* keyID */ pd.keyId,
                    /* counterparty */ pd.counterparty,
                    /* otherPubkey */ pd.counterpartyDerivedKey,
                    /* signOutputs */ "single",
                    /* anyoneCanPay */ true,
                    /* sourceSatoshis */ undefined,
                    /* lockingScript */ undefined,
                    /* firstPubkeyIsWallet */ pd.order === 'self-first',
                    /* protocolID */ TOKEN_PROTOCOL,
                )
                : new PaymentUtxo().unlock(
                    /* wallet */ wallet,
                    /* keyID */ "0",
                    /* counterparty */ "self",
                    /* otherPubkey */ property.seller,
                    /* signOutputs */ "single",
                    /* anyoneCanPay */ true,
                    /* sourceSatoshis */ undefined,
                    /* lockingScript */ undefined,
                    /* firstPubkeyIsWallet */ true,
                );

            const assetId = currentOrdinalOutpoint.replace(".", "_");
            // Derive a per-output child key for the investor (only they can derive the matching private key)
            const transferNonce = generateNonce();
            const investorChild = await deriveRecipientKey(wallet, investorId, transferNonce);
            // Lock to the investor's derived child key.
            const investorPubKeyHash = Hash.hash160(investorChild, "hex") as number[];
            const ordinalTransferScript = new OrdinalsP2PKH().lock(
                /* address */ investorPubKeyHash,
                /* assetId */ assetId,
                /* tokenTxid */ propertyTokenTxid,
                /* shares */ amount,
                /* type */ "transfer"
            );

            // Also get the amount of tokens left from the actual ordinalTxLockingscript
            // Then calculate the token change to send back to the original mintTx
            const changeAmount = await calcTokenTransfer(fullParentTx, parentVout, amount);

            if (changeAmount < 0) {
                throw new Error("Not enough tokens to purchase");
            }
            // On the final sale (buying all remaining shares) there is no ordinal change.
            const hasOrdinalChange = changeAmount > 0;

            // Ordinal change: derived 1-of-2 multisig (server + seller).
            const changeNonce = generateNonce();
            const { selfKey: serverChangeChild, counterpartyKey: sellerChangeChild } = await deriveMultisigPair(wallet, property.seller, changeNonce);
            // Concat order [seller, server] (must match spend).
            const oneOfTwohashForChange = hashFromPubkeys([PublicKey.fromString(sellerChangeChild), PublicKey.fromString(serverChangeChild)]);

            const changeScript = new OrdinalsP2MS().lock(
                /* oneOfTwoHash */ oneOfTwohashForChange,
                /* assetId */ property.txids.originalMintTxid.replace(".", "_"),
                /* tokenTxid */ propertyTokenTxid,
                /* shares */ changeAmount,
                /* type */ "transfer"
            );

            // Payment source still via overlay (legacy); ordinal uses carry-forward above.
            const { txid: paymentTxID, vout: paymentVout } = parseOutpoint(property.txids.paymentTxid as string);
            const paymentTx = await getTransactionByTxID(paymentTxID);
            if (!paymentTx) {
                throw new Error("Failed to get transaction by txid");
            }

            // Payment CHANGE: derived 1-of-2 multisig (server + seller) at a FRESH nonce.
            // Committed order [seller, server] => server is self-second on its next spend.
            const changePaymentNonce = generateNonce();
            const { selfKey: serverPaymentChangeChild, counterpartyKey: sellerPaymentChangeChild } = await deriveMultisigPair(wallet, property.seller, changePaymentNonce);
            const oneOfTwoHash = hashFromPubkeys([PublicKey.fromString(sellerPaymentChangeChild), PublicKey.fromString(serverPaymentChangeChild)]);
            const paymentChangeLockingScript = new PaymentUtxo().lock(/* oneOfTwoHash */ oneOfTwoHash);

            const paymentSourceTX = Transaction.fromBEEF(paymentTx.outputs[0].beef as number[]);

            // Build a preimage transaction mirroring the final spend for correct signatures
            const preimageTx = new Transaction();
            preimageTx.addInput({
                sourceTransaction: fullParentTx,
                sourceOutputIndex: parentVout,
                unlockingScriptTemplate: ordinalUnlockingFrame,
            });
            preimageTx.addInput({
                sourceTransaction: paymentSourceTX,
                sourceOutputIndex: paymentVout,
                unlockingScriptTemplate: paymentUnlockFrame,
            });
            preimageTx.addOutput({
                satoshis: 1,
                lockingScript: ordinalTransferScript,
            });
            if (hasOrdinalChange) {
                preimageTx.addOutput({
                    satoshis: 1,
                    lockingScript: changeScript,
                });
            }
            // Track our payment-change index explicitly — the wallet may append its own
            // inputs/outputs in the real tx, so we can't assume it's the last output.
            const paymentChangeIndex = hasOrdinalChange ? 2 : 1;
            preimageTx.addOutput({
                change: true,
                lockingScript: paymentChangeLockingScript,
            });

            await preimageTx.fee(new SatoshisPerKilobyte(100))
            await preimageTx.sign()

            // fee() drops the payment change when the pool can't cover it (e.g. a final sale draining it).
            const paymentChangeOutput = preimageTx.outputs[paymentChangeIndex];
            const hasPaymentChange = !!paymentChangeOutput;
            const paymentChangeSats = (paymentChangeOutput?.satoshis as number) ?? 0;

            // Get unlocking script lengths from preimage transaction
            const ordinalUnlockingScript = preimageTx.inputs[0].unlockingScript as UnlockingScript;
            const paymentUnlockingScript = preimageTx.inputs[1].unlockingScript as UnlockingScript;
            const ordinalUnlockingScriptLength = ordinalUnlockingScript.toHex().length / 2;
            const paymentUnlockingScriptLength = paymentUnlockingScript.toHex().length / 2;

            const outputs: { outputDescription: string; satoshis: number; lockingScript: string }[] = [
                {
                    outputDescription: "Ordinal transfer",
                    satoshis: 1,
                    lockingScript: ordinalTransferScript.toHex(),
                },
            ];
            if (hasOrdinalChange) {
                outputs.push({
                    outputDescription: "Ordinal token change",
                    satoshis: 1,
                    lockingScript: changeScript.toHex(),
                });
            }
            if (hasPaymentChange) {
                outputs.push({
                    outputDescription: "Payment change",
                    satoshis: paymentChangeSats,
                    lockingScript: paymentChangeLockingScript.toHex(),
                });
            }

            // Merge the two input beefs required for the inputBEEF
            const beef = new Beef();
            beef.mergeBeef(fullParentTx.toBEEF());
            beef.mergeBeef(paymentTx.outputs[0].beef);

            // -----------------------------------------------------------------
            // ONE enqueue for createAction, signAction, AND the internalizeAction
            // that files the ordinal change. Everything that touches the server
            // wallet's UTXO set or basket lives in here.
            // -----------------------------------------------------------------
            // Captured into a local before the closure: TS narrowing of
            // property.txids.paymentTxid (guarded above) doesn't cross the
            // enqueue callback's function boundary. Same value as the source's
            // `property.txids.paymentTxid`, just bound outside the closure.
            const paymentTxidOutpoint = property.txids.paymentTxid as string;

            const queue = await getWalletQueue();
            transfer = await queue.enqueue('share-purchase', async (wallet) => {
                // Create the transfer transaction with unlockingScriptLength
                const actionRes = await wallet.createAction({
                    description: "Transfer share",
                    inputBEEF: beef.toBinary(),
                    inputs: [
                        {
                            inputDescription: "Ordinal transfer",
                            outpoint: currentOrdinalOutpoint,
                            unlockingScriptLength: ordinalUnlockingScriptLength,
                        },
                        {
                            inputDescription: "Payment",
                            outpoint: paymentTxidOutpoint,
                            unlockingScriptLength: paymentUnlockingScriptLength,
                        }
                    ],
                    outputs,
                    options: {
                        randomizeOutputs: false,
                        acceptDelayedBroadcast: false,
                    }
                })

                if (!actionRes?.signableTransaction) {
                    throw new Error("Failed to create signable transaction");
                }

                const reference = actionRes.signableTransaction.reference;
                const txToSign = Transaction.fromBEEF(actionRes.signableTransaction.tx);

                // Add unlocking script templates to inputs (reuse frames from preimage)
                txToSign.inputs[0].unlockingScriptTemplate = ordinalUnlockingFrame;
                txToSign.inputs[0].sourceTransaction = fullParentTx;
                txToSign.inputs[1].unlockingScriptTemplate = paymentUnlockFrame;
                txToSign.inputs[1].sourceTransaction = paymentSourceTX;

                // Sign the complete transaction
                await txToSign.sign();

                // Extract the unlocking scripts
                const finalOrdinalUnlockingScript = txToSign.inputs[0].unlockingScript?.toHex();
                const finalPaymentUnlockingScript = txToSign.inputs[1].unlockingScript?.toHex();

                if (!finalOrdinalUnlockingScript || !finalPaymentUnlockingScript) {
                    throw new Error("Missing unlocking scripts");
                }

                // Sign the action with the actual unlocking scripts
                const transferTx = await wallet.signAction({
                    reference,
                    spends: {
                        "0": { unlockingScript: finalOrdinalUnlockingScript },
                        "1": { unlockingScript: finalPaymentUnlockingScript }
                    }
                });

                if (!transferTx?.txid) {
                    throw new Error("Failed to sign transfer transaction");
                }

                const atomicBeef = transferTx.tx as number[];

                if (hasOrdinalChange) {
                    // Record the ordinal change (output 1) in the server basket; counterparty = seller.
                    await internalizeToBasket(wallet, atomicBeef, [{
                        outputIndex: 1, keyId: changeNonce, counterparty: property.seller,
                        counterpartyDerivedKey: sellerChangeChild, order: 'self-second', tags: ['type:share'],
                    }], "Share change (server side)");
                }

                return { txid: transferTx.txid as string, atomicBeef };
            });
            // -----------------------------------------------------------------
            // End of the wallet-serialized region.
            // -----------------------------------------------------------------

            const { txid: transferTxid, atomicBeef } = transfer;

            const set: Record<string, unknown> = {};

            if (hasOrdinalChange) {
                // Advance currentOutpoint to the ordinal change; carry derivation + BEEF for its next spend.
                set["txids.currentOutpoint"] = toOutpoint(transferTxid, 1);
                set["currentDerivation"] = {
                    keyId: changeNonce,
                    counterparty: property.seller,
                    counterpartyDerivedKey: sellerChangeChild,
                    order: 'self-second',
                    beef: encodeBeef(atomicBeef),
                };
            }
            // Final sale (no ordinal change): leave currentOutpoint as-is; status → funded below.
            if (hasPaymentChange) {
                set["txids.paymentTxid"] = toOutpoint(transferTxid, paymentChangeIndex);
                set["paymentDerivation"] = {
                    keyId: changePaymentNonce,
                    counterparty: property.seller,
                    counterpartyDerivedKey: sellerPaymentChangeChild,
                    order: 'self-second',
                };
            }
            if (Object.keys(set).length > 0) {
                await propertiesCollection.updateOne({ _id: propertyObjectId }, { $set: set });
            }

            // Check if this investor already has shares for this property
            const existingInvestorShares = await sharesCollection.findOne({
                propertyId: propertyObjectId,
                investorId,
            });
            const isNewInvestor = !existingInvestorShares;

            // Build share record; parent is the outpoint we spent from (currentOutpoint before update)
            const formattedShare: Shares = {
                _id: new ObjectId(),
                propertyId: propertyObjectId,
                investorId,
                amount,
                parentTxid: currentOrdinalOutpoint,
                transferTxid: toOutpoint(transferTxid, 0),
                createdAt: new Date(),
                // Investor's single-sig P2PKH derivation: they unlock with counterparty = server identity
                keyId: transferNonce,
                counterparty: serverIdentityKey,
            }
            const share = await sharesCollection.insertOne(formattedShare);

            // Atomically update remainingPercent, investor count, and check if fully funded
            if (percentToSell != null) {
                const newRemainingPercent = (property?.sell?.remainingPercent ?? percentToSell) - amount;
                const updateFields: any = {
                    "sell.remainingPercent": newRemainingPercent
                };

                // Update status to "funded" if all shares are sold
                if (newRemainingPercent <= 0) {
                    updateFields.status = "funded";
                }

                // Increment investor count only if this is a new investor
                const updateOperation: any = { $set: updateFields };
                if (isNewInvestor) {
                    updateOperation.$inc = { investors: 1 };
                }

                await propertiesCollection.updateOne(
                    { _id: propertyObjectId },
                    updateOperation
                );
            } else if (isNewInvestor) {
                // If no percentToSell tracking, still increment investor count for new investors
                await propertiesCollection.updateOne(
                    { _id: propertyObjectId },
                    { $inc: { investors: 1 } }
                );
            }

            res.json({
                share,
                isNewInvestor,
                received: { atomicBeef: encodeBeef(atomicBeef), outputIndex: 0, keyId: transferNonce, counterparty: serverIdentityKey },
            });

            // Broadcast the transfer transaction to the Overlay for later lookup.
            // SANCTIONED CHANGE vs the Next route: this runs AFTER res.json and
            // OUTSIDE the queue. signAction already broadcast to chain
            // (acceptDelayedBroadcast: false), so the overlay push is
            // best-effort indexing and must not hold the queue or the client.
            // The whole chain — including the BEEF decode — is .catch()-wrapped:
            // an unhandled rejection after res.json would kill this single
            // process and with it the entire API.
            void Promise.resolve()
                .then(async () => {
                    const tx = Transaction.fromBEEF(atomicBeef);
                    // txid derived locally, never taken from the broadcast result
                    const txid = tx.id('hex');
                    const overlayResponse = await broadcastTX(tx);

                    if (overlayResponse.status !== "success") {
                        logger.debug(`Failed to broadcast transaction for ${txid}`);
                    }
                })
                .catch((e) => {
                    logger.error('[share-purchase] overlay broadcast failed (non-blocking):', e);
                });
        } catch (e) {
            logger.error(e);
            res.status(500).json({ error: "Internal server error" });
            if (transfer) {
                // signAction already broadcast this tx to chain; a post-enqueue
                // failure (e.g. one of the DB writes above) must not skip the
                // only indexing path. Guaranteed not to double-push: this catch
                // block and the success path above are mutually exclusive.
                const { atomicBeef } = transfer;
                void Promise.resolve()
                    .then(async () => {
                        const tx = Transaction.fromBEEF(atomicBeef);
                        const txid = tx.id('hex');
                        const overlayResponse = await broadcastTX(tx);

                        if (overlayResponse.status !== "success") {
                            logger.debug(`Failed to broadcast transaction for ${txid}`);
                        }
                    })
                    .catch((e2) => {
                        logger.error('[share-purchase] overlay broadcast failed (non-blocking):', e2);
                    });
            }
        } finally {
            // Release lock
            try {
                if (lockId) {
                    await locksCollection.deleteOne({ _id: lockId });
                }
            } catch { }
        }
    },
);
