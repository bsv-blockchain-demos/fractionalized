import { connectToMongo, propertiesCollection, Shares, sharesCollection, locksCollection } from "../../../lib/mongo";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { makeWallet } from "../../../lib/serverWallet";
import { Signature, TransactionSignature, Transaction, LockingScript, Beef, Hash, PublicKey, UnlockingScript, SatoshisPerKilobyte } from "@bsv/sdk";
import { OrdinalsP2PKH } from "../../../utils/ordinalsP2PKH";
import { OrdinalsP2MS } from "../../../utils/ordinalsP2MS";
import { broadcastTX, getTransactionByTxID } from "../../../hooks/overlayFunctions";
import { calcTokenTransfer } from "../../../hooks/calcTokenTransfer";
import { PaymentUtxo } from "../../../utils/paymentUtxo";
import { parseOutpoint, toOutpoint } from "../../../utils/outpoints";
import { requireAuth } from "../../../utils/apiAuth";
import { hashFromPubkeys } from "../../../utils/hashFromPubkeys";

const STORAGE = process.env.STORAGE_URL;
const SERVER_KEY = process.env.SERVER_PRIVATE_KEY;

export async function POST(request: Request) {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const userId = auth.user;
    const { propertyId, investorId, amount } = await request.json();
    console.log("InvestorId", investorId)

    // Verify the investoryId (requester) is the logged in user
    if (userId !== investorId) {
        return NextResponse.json({ error: "You can't make a purchase for another user" }, { status: 403 });
    }

    // Verify the purchase and make a blockchain transaction

    // Transfer 1satOrdinal from the property UTXO to the investor
    let lockId: ObjectId | null = null;
    try {
        await connectToMongo();

        if (!SERVER_KEY || !STORAGE) {
            return NextResponse.json({ error: "Server wallet not configured" }, { status: 500 });
        }
        const wallet = await makeWallet("main", STORAGE as string, SERVER_KEY as string);
        if (!wallet) {
            throw new Error("Failed to create wallet");
        }
        const propertyObjectId = new ObjectId(propertyId);
        if (typeof investorId !== "string") {
            return NextResponse.json({ error: "Invalid investorId" }, { status: 400 });
        }

        if (amount <= 0) {
            return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
        } else if (amount > 100) {
            return NextResponse.json({ error: "Amount must be less than 100%" }, { status: 400 });
        } else if (typeof amount !== 'number') {
            return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
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
                return NextResponse.json({ error: "Another transfer is in progress for this investor and property" }, { status: 409 });
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
                return NextResponse.json(
                    { error: `Cannot purchase ${amount}% - only ${remainingPercent.toFixed(2)}% remaining` },
                    { status: 400 }
                );
            }
        }

        // Get property token txid to put in the inscribed token (for indentification)
        const propertyTokenTxid = property.txids.tokenTxid;

        // Payment unlocking will be signed against the preimage (frame-based)

        // Spend from the current outpoint (either original mint or latest change output)
        const currentOrdinalOutpoint = property.txids.currentOutpoint as string;
        const { txid: parentTxID, vout: parentVout } = parseOutpoint(currentOrdinalOutpoint);

        // Use overlay query with parentTxID to get full TX
        const response = await getTransactionByTxID(parentTxID);
        const txbeef = response?.outputs[0].beef;

        if (!response || !txbeef) {
            throw new Error("Failed to get transaction by txid");
        }

        const fullParentTx = Transaction.fromBEEF(txbeef as number[]);

        // Create the ordinal unlocking and locking script for transfer (mint spend => treat as first)
        const ordinalUnlockingFrame = new OrdinalsP2MS().unlock(
            /* wallet */ wallet,
            /* keyID */ "0",
            /* counterparty */ "self",
            /* otherPubkey */ property.seller,
            /* signOutputs */ "single",
            /* anyoneCanPay */ true,
            /* sourceSatoshis */ undefined,
            /* lockingScript */ undefined,
            /* firstPubkeyIsWallet */ false
        );

        const paymentUnlockFrame = new PaymentUtxo().unlock(
            /* wallet */ wallet,
            /* otherPubkey */ property.seller,
            /* signOutputs */ "single",
            /* anyoneCanPay */ true,
            /* sourceSatoshis */ undefined,
            /* lockingScript */ undefined
        );

        const assetId = currentOrdinalOutpoint.replace(".", "_");
        // Hash the public key to get pubKeyHash for P2PKH locking script
        const investorPubKeyHash = Hash.hash160(investorId, "hex") as number[];
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

        // Only allow change if it's from the original mint outpoint
        const { publicKey: serverKey } = await wallet.getPublicKey({
            protocolID: [0, "fractionalized"],
            keyID: "0",
        });
        // IMPORTANT: Order must match original mint in admin.tsx: [user/seller, server]
        const oneOfTwohashForChange = hashFromPubkeys([PublicKey.fromString(property.seller), PublicKey.fromString(serverKey)]);

        const changeScript = new OrdinalsP2MS().lock(
            /* oneOfTwoHash */ oneOfTwohashForChange,
            /* assetId */ property.txids.originalMintTxid.replace(".", "_"),
            /* tokenTxid */ propertyTokenTxid,
            /* shares */ changeAmount,
            /* type */ "transfer"
        );

        // Query to overlay to get the TX beefs
        const ordParentTx = await getTransactionByTxID(parentTxID);
        if (!ordParentTx) {
            throw new Error("Failed to get transaction by txid");
        }

        const { txid: paymentTxID, vout: paymentVout } = parseOutpoint(property.txids.paymentTxid as string);
        const paymentTx = await getTransactionByTxID(paymentTxID);
        if (!paymentTx) {
            throw new Error("Failed to get transaction by txid");
        }

        // Create new multiSig lockingScript for the payment change UTXO
        const oneOfTwoHash = hashFromPubkeys([PublicKey.fromString(serverKey), PublicKey.fromString(property.seller)]);
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
        preimageTx.addOutput({
            satoshis: 1,
            lockingScript: changeScript,
        });
        preimageTx.addOutput({
            change: true,
            lockingScript: paymentChangeLockingScript,
        });

        await preimageTx.fee(new SatoshisPerKilobyte(100))
        await preimageTx.sign()

        console.log('[Share-Purchase] Transaction to sign: ', preimageTx.toHex())

        const paymentChangeSats = preimageTx.outputs[2].satoshis as number;

        const ordinalUnlockingScript = preimageTx.inputs[0].unlockingScript as UnlockingScript
        const paymentUnlockingScript = preimageTx.inputs[1].unlockingScript as UnlockingScript

        const outputs: { outputDescription: string; satoshis: number; lockingScript: string }[] = [
            {
                outputDescription: "Ordinal transfer",
                satoshis: 1,
                lockingScript: ordinalTransferScript.toHex(),
            },
            {
                outputDescription: "Ordinal token change",
                satoshis: 1,
                lockingScript: changeScript.toHex(),
            },
            {
                outputDescription: "Payment change",
                satoshis: paymentChangeSats,
                lockingScript: paymentChangeLockingScript.toHex(),
            },
        ];

        // Merge the two input beefs required for the inputBEEF
        const beef = new Beef();
        beef.mergeBeef(ordParentTx.outputs[0].beef);
        beef.mergeBeef(paymentTx.outputs[0].beef);

        // Create the transfer transaction
        const transferTx = await wallet.createAction({
            description: "Transfer share",
            inputBEEF: beef.toBinary(),
            inputs: [
                {
                    inputDescription: "Ordinal transfer",
                    outpoint: currentOrdinalOutpoint,
                    unlockingScript: ordinalUnlockingScript.toHex(),
                },
                {
                    inputDescription: "Payment",
                    outpoint: property.txids.paymentTxid,
                    unlockingScript: paymentUnlockingScript.toHex(),
                }
            ],
            outputs,
            options: {
                randomizeOutputs: false,
            }
        })

        if (!transferTx) {
            throw new Error("Failed to create transfer transaction");
        }

        // Broadcast the transfer transaction to the Overlay for later lookup
        const tx = Transaction.fromBEEF(transferTx.tx as number[]);
        const overlayResponse = await broadcastTX(tx);

        if (overlayResponse.status !== "success") {
            console.log(`Failed to broadcast transaction for ${transferTx.txid}`);
        }

        // Update the current outpoint to point to the change output for next purchase
        const newCurrentOutpoint = toOutpoint(transferTx.txid as string, 1);
        const updateRes = await propertiesCollection.updateOne(
            { _id: propertyObjectId },
            {
                $set: {
                    "txids.currentOutpoint": newCurrentOutpoint,
                    "txids.paymentTxid": toOutpoint(transferTx.txid as string, 2),
                    // Keep mintTxid for backward compatibility
                    "txids.mintTxid": newCurrentOutpoint,
                }
            }
        );
        if (!updateRes.modifiedCount) {
            throw new Error("Failed to update current outpoint");
        }

        // Build share record; parent is the outpoint we spent from (currentOutpoint before update)
        const formattedShare: Shares = {
            _id: new ObjectId(),
            propertyId: propertyObjectId,
            investorId,
            amount,
            parentTxid: currentOrdinalOutpoint,
            transferTxid: toOutpoint(transferTx.txid as string, 0),
            createdAt: new Date(),
        }
        const share = await sharesCollection.insertOne(formattedShare);

        // Atomically update remainingPercent and check if fully funded
        if (percentToSell != null) {
            const newRemainingPercent = (property?.sell?.remainingPercent ?? percentToSell) - amount;
            const updateFields: any = {
                "sell.remainingPercent": newRemainingPercent
            };

            // Update status to "funded" if all shares are sold
            if (newRemainingPercent <= 0) {
                updateFields.status = "funded";
            }

            await propertiesCollection.updateOne(
                { _id: propertyObjectId },
                { $set: updateFields }
            );
        }

        return NextResponse.json({ share });
    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    } finally {
        // Release lock
        try {
            if (lockId) {
                await locksCollection.deleteOne({ _id: lockId });
            }
        } catch { }
    }
}