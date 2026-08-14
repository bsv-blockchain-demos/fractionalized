import { Router, type Request, type Response } from 'express';
import { ObjectId } from 'mongodb';
import { Beef, Hash, Transaction } from '@bsv/sdk';
import { connectToMongo, propertiesCollection, sharesCollection, locksCollection, marketItemsCollection, listingBeefsCollection } from '../../src/lib/mongo';
import type { Shares } from '../../src/lib/mongo';
import { OrdinalsP2PKH } from '../../src/utils/ordinalsP2PKH';
import { OrdinalsP2MS } from '../../src/utils/ordinalsP2MS';
import { PaymentUtxo } from '../../src/utils/paymentUtxo';
import { broadcastTX } from '../../src/hooks/overlayFunctions';
import { traceShareChain } from '../../src/utils/shareChain';
import { toOutpoint, parseOutpoint } from '../../src/utils/outpoints';
import { fetchTokenSourceTx } from '../../src/utils/fetchTokenSourceTx';
import { generateNonce, deriveRecipientKey, deriveMultisigPair, getIdentityKey, TOKEN_PROTOCOL } from '../../src/utils/tokenDerivation';
import { encodeBeef } from '../../src/utils/beefEncoding';
import { logger } from '../../src/utils/logger';
import { getWalletQueue } from '../lib/walletQueue';
import { getServerWallet } from '../lib/serverWallet';
import { requireSession } from '../middleware/requireSession';
import { requireAuthProof } from '../middleware/requireAuthProof';
import { AUTH_PROOF_PURPOSE } from '../../src/lib/authProofPurposes';

export const listingPurchaseRouter = Router();

/**
 * POST /api/listing-purchase — transfer a secondary-market listing's shares
 * from the listing multisig to the buyer.
 *
 * Ported verbatim from src/app/api/listing-purchase/route.ts, with one
 * bugfix: the source broadcast the transfer transaction via signAction, then
 * broadcast AGAIN to the overlay and THREW if that overlay push failed —
 * after the transfer was already final on-chain. That throw skipped the DB
 * writes below (shares insert, listing-beef cleanup, market-item sold flag),
 * permanently desyncing the DB from the chain. Here, as in tokenize.ts and
 * sharePurchase.ts, the overlay push is best-effort and runs AFTER the
 * response, outside the queue.
 *
 * THE critical region alongside tokenize and share-purchase: createAction and
 * signAction (and the txToSign.sign() between them) run inside ONE
 * queue.enqueue() so no other request can select UTXOs between them.
 * Everything before the enqueue — validation, the Mongo advisory lock, DB
 * reads, and fetchTokenSourceTx — is network I/O and must NOT hold the
 * wallet lock. Never call enqueue() (or getWalletQueue()) from inside the
 * callback — that deadlocks the queue permanently; the wallet arrives as the
 * callback parameter. Key-derivation and unlock-frame construction
 * (generateNonce/deriveRecipientKey/deriveMultisigPair/getIdentityKey and the
 * .estimateLength() calls used only to size unlocking scripts) don't touch
 * the wallet's UTXO set, so they run outside the enqueue via the shared
 * getServerWallet() wallet — the same underlying wallet instance the queue
 * wraps.
 *
 * Guard: requireSession (login) AND requireAuthProof(AUTH_PROOF_PURPOSE.listingPurchase)
 * — a single-use signed proof bound to this action. The Next source was session-only;
 * the proof is a deliberate Task 12 defence-in-depth addition, not a port artifact —
 * do not remove it to "restore fidelity" with the source.
 */
listingPurchaseRouter.post(
    '/',
    requireSession,
    requireAuthProof(AUTH_PROOF_PURPOSE.listingPurchase),
    async (req: Request, res: Response) => {
        const userId = req.userId as string;
        const { marketItemId, buyerId, paymentNonce, paymentTX } = req.body;

        // Verify the investoryId (requester) is the logged in user
        if (userId !== buyerId) {
            res.status(403).json({ error: "You can't make a purchase for another user" });
            return;
        }

        let lockId: ObjectId | null = null;
        let transfer: { txid: string; atomicBeef: number[] } | undefined;
        try {
            await connectToMongo();

            const wallet = await getServerWallet();
            if (!wallet) {
                throw new Error("Failed to create wallet");
            }

            // Fetch all necessary data from marketItem collection -> share collection -> property collection
            const marketItem = await marketItemsCollection.findOne({ _id: new ObjectId(marketItemId) });
            if (!marketItem) {
                throw new Error("Market item not found");
            }
            const share = await sharesCollection.findOne({ _id: new ObjectId(marketItem.shareId) });
            if (!share) {
                throw new Error("Share not found");
            }
            const property = await propertiesCollection.findOne({ _id: new ObjectId(share.propertyId) });
            if (!property) {
                throw new Error("Property not found");
            }

            const propertyObjectId = new ObjectId(property._id);

            if (!property?.txids?.tokenTxid || (!property?.txids?.originalMintTxid && !property?.txids?.mintTxid)) {
                throw new Error("Property token/payment UTXOs not initialized");
            }

            // Trace chain of share before proceeding
            const traceRes = await traceShareChain({ propertyId: propertyObjectId, leafTransferTxid: share.transferTxid });
            if (!traceRes) {
                throw new Error("Invalid share");
            }

            // Acquire lock per (property, buyer)
            try {
                const lockRes = await locksCollection.insertOne({
                    _id: new ObjectId(),
                    propertyId: propertyObjectId,
                    investorId: buyerId,
                    createdAt: new Date(),
                });
                lockId = lockRes.insertedId;
            } catch (e: any) {
                if (e?.code === 11000) {
                    res.status(409).json({ error: "Another transfer is in progress for this seller and property" });
                    return;
                }
                throw e;
            }

            // Resolve the listing's source tx from the DB backup (listing_beefs), falling back to overlay.
            const { txid: ordinalTxid, vout: ordinalVout } = parseOutpoint(share.transferTxid);
            const beefDoc = await listingBeefsCollection.findOne({ listingId: marketItemId });
            const fullOrdinalTx = await fetchTokenSourceTx(share.transferTxid, beefDoc?.beef);

            const serverIdentityKey = await getIdentityKey(wallet);

            // Derive the buyer's P2PKH key at a fresh nonce (server is sender; only buyer can derive priv).
            const buyNonce = generateNonce();
            const buyerChild = await deriveRecipientKey(wallet, buyerId, buyNonce);

            // Create ordinal transfer transaction scripts
            // Lock to the buyer's DERIVED P2PKH key hash.
            const buyerPubKeyHash = Hash.hash160(buyerChild, "hex") as number[];
            const ordinalTransferScript = new OrdinalsP2PKH().lock(
                /* address */ buyerPubKeyHash,
                /* assetId */ share.transferTxid.replace(".", "_"),
                /* tokenTxid */ property.txids.tokenTxid,
                /* shares */ share.amount,
                /* type */ "transfer"
            );

            // Payment unlocking will be signed against a preimage (frame-based)

            // Server spends the listing multisig by deriving against the seller; legacy listings use the self/0 form.
            const ordinalUnlockingFrame = marketItem.keyId
                ? new OrdinalsP2MS().unlock(
                    /* wallet */ wallet,
                    /* keyID */ marketItem.keyId,
                    /* counterparty */ marketItem.counterparty as string,
                    /* otherPubkey */ marketItem.counterpartyDerivedKey as string,
                    /* signOutputs */ "single",
                    /* anyoneCanPay */ true,
                    /* sourceSatoshis */ undefined,
                    /* lockingScript */ undefined,
                    /* firstPubkeyIsWallet */ marketItem.order === 'self-first',
                    /* protocolID */ TOKEN_PROTOCOL,
                )
                : new OrdinalsP2MS().unlock(
                    /* wallet */ wallet,
                    /* keyID */ "0",
                    /* counterparty */ "self",
                    /* otherPubkey */ share.investorId,
                    /* signOutputs */ "single",
                    /* anyoneCanPay */ true,
                    /* sourceSatoshis */ undefined,
                    /* lockingScript */ undefined,
                    /* firstPubkeyIsWallet */ true
                );

            // Spend the buyer's fee payment via its derived key.
            // Client locked [buyerChild, serverChild] (buyer first) => server is self-second (firstPubkeyIsWallet=false).
            const { counterpartyKey: buyerPaymentChild } = await deriveMultisigPair(wallet, buyerId, paymentNonce);
            const paymentUnlockFrame = new PaymentUtxo().unlock(
                /* wallet */ wallet,
                /* keyID */ paymentNonce,
                /* counterparty */ buyerId,
                /* otherPubkey */ buyerPaymentChild,
                /* signOutputs */ "single",
                /* anyoneCanPay */ true,
                /* sourceSatoshis */ undefined,
                /* lockingScript */ undefined,
                /* firstPubkeyIsWallet */ false,
                /* protocolID */ TOKEN_PROTOCOL,
            );

            const ordinalUnlockingScriptLength = await ordinalUnlockingFrame.estimateLength();
            const paymentUnlockingScriptLength = await paymentUnlockFrame.estimateLength();

            // Merge the two input beefs required for the inputBEEF
            const beef = new Beef();
            beef.mergeBeef(fullOrdinalTx.toBEEF());
            beef.mergeBeef(paymentTX.tx);

            // -----------------------------------------------------------------
            // ONE enqueue for createAction AND signAction. Everything that
            // touches the server wallet's UTXO set lives in here.
            // -----------------------------------------------------------------
            const queue = await getWalletQueue();
            transfer = await queue.enqueue('listing-purchase', async (wallet) => {
                // Create transfer transaction with unlockingScriptLength
                const actionRes = await wallet.createAction({
                    description: "Transfer share",
                    inputBEEF: beef.toBinary(),
                    inputs: [
                        {
                            inputDescription: "Ordinal transfer",
                            outpoint: share.transferTxid,
                            unlockingScriptLength: ordinalUnlockingScriptLength,
                        },
                        {
                            inputDescription: "Fee payment",
                            outpoint: toOutpoint(paymentTX.txid as string, 0),
                            unlockingScriptLength: paymentUnlockingScriptLength,
                        }
                    ],
                    outputs: [
                        {
                            outputDescription: "Ordinal transfer",
                            satoshis: 1,
                            lockingScript: ordinalTransferScript.toHex(),
                        },
                    ],
                    options: {
                        randomizeOutputs: false,
                        acceptDelayedBroadcast: false,
                    }
                });

                if (!actionRes?.signableTransaction) {
                    throw new Error("Failed to create signable transaction");
                }

                const reference = actionRes.signableTransaction.reference;
                const txToSign = Transaction.fromBEEF(actionRes.signableTransaction.tx);

                // Add unlocking script templates to inputs (reuse frames from preimage)
                txToSign.inputs[0].unlockingScriptTemplate = ordinalUnlockingFrame;
                txToSign.inputs[0].sourceTransaction = fullOrdinalTx;
                txToSign.inputs[1].unlockingScriptTemplate = paymentUnlockFrame;
                txToSign.inputs[1].sourceTransaction = paymentTX;

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

                return { txid: transferTx.txid as string, atomicBeef: transferTx.tx as number[] };
            });
            // -----------------------------------------------------------------
            // End of the wallet-serialized region.
            // -----------------------------------------------------------------

            const { txid: transferTxid, atomicBeef } = transfer;

            // Broadcast the transfer transaction to the Overlay for later lookup.
            // SANCTIONED CHANGE vs the Next route: this runs AFTER res.json and
            // OUTSIDE the queue. signAction already broadcast to chain
            // (acceptDelayedBroadcast: false), so the overlay push is
            // best-effort indexing and must not hold the queue or the client.
            // The source THREW here (:221-223) and left the DB permanently
            // inconsistent with the chain on a failed overlay push; the DB
            // writes below now run regardless of the overlay result.
            // The whole chain — including the BEEF decode — is .catch()-wrapped:
            // an unhandled rejection after res.json would kill this single
            // process and with it the entire API.
            const pushToOverlay = (): void => {
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
                        logger.error('[listing-purchase] overlay broadcast failed (non-blocking):', e);
                    });
            };

            // Update shares collection. Buyer's P2PKH: keyId=buyNonce, counterparty=server (buyer unlocks against server).
            const formattedShare: Shares = {
                _id: new ObjectId(),
                propertyId: propertyObjectId,
                investorId: buyerId,
                amount: marketItem.sellAmount,
                parentTxid: share.transferTxid,
                transferTxid: toOutpoint(transferTxid, 0),
                createdAt: new Date(),
                keyId: buyNonce,
                counterparty: serverIdentityKey,
            };
            const shareRes = await sharesCollection.insertOne(formattedShare);
            if (!shareRes.insertedId) {
                throw new Error("Failed to create share");
            }

            // Listing consumed: drop its BEEF backup.
            await listingBeefsCollection.deleteOne({ listingId: marketItemId });

            // Update listing
            const listingRes = await marketItemsCollection.updateOne({ _id: new ObjectId(marketItemId) }, { $set: { sold: true } }, { upsert: true });
            if (!listingRes.modifiedCount) {
                throw new Error("Failed to update listing");
            }

            res.json({
                status: "success",
                received: {
                    atomicBeef: encodeBeef(atomicBeef),
                    outputIndex: 0,
                    keyId: buyNonce,
                    counterparty: serverIdentityKey,
                },
            });

            pushToOverlay();
        } catch (e) {
            logger.error(e);
            res.status(500).json({ error: "Internal server error" });
            if (transfer) {
                // signAction already broadcast this tx to chain; a post-enqueue
                // failure (e.g. a DB write above) must not skip the only
                // indexing path. Guaranteed not to double-push: this catch
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
                        logger.error('[listing-purchase] overlay broadcast failed (non-blocking):', e2);
                    });
            }
        } finally {
            try {
                if (lockId) {
                    await locksCollection.deleteOne({ _id: lockId });
                }
            } catch { }
        }
    },
);
