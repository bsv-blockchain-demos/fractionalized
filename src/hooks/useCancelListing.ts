"use client";

import { useState } from "react";
import { toast } from "react-hot-toast";
import { useAuthContext } from "../context/walletContext";
import { OrdinalsP2MS } from "../utils/ordinalsP2MS";
import { OrdinalsP2PKH } from "../utils/ordinalsP2PKH";
import { broadcastTX } from "./overlayFunctions";
import { calcTokenTransfer } from "./calcTokenTransfer";
import { Hash, Transaction, SatoshisPerKilobyte, UnlockingScript } from "@bsv/sdk";
import { parseOutpoint, toOutpoint } from "../utils/outpoints";
import { SERVER_IDENTITY_KEY } from "../utils/env";
import { generateNonce, deriveMultisigPair, deriveOwnKey, TOKEN_PROTOCOL } from "../utils/tokenDerivation";
import { internalizeToBasket } from "../utils/internalizeToBasket";
import { decodeBeef, encodeBeef } from "../utils/beefEncoding";

export interface CancelListingItem {
  _id: string;
  propertyId: string;
  sellAmount: number;
  listingNonce?: string;
  listingOutpoint?: string;
  listingBeef?: string;
  tokenTxid?: string;
}

export function useCancelListing() {
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const { userWallet, userPubKey, initializeWallet } = useAuthContext();

  // Cancel a listing: reclaim the share from the multisig(seller+server) back to the seller's
  // own self-custody P2PKH. The seller builds + signs the spend client-side.
  const cancelListing = async (item: CancelListingItem): Promise<boolean> => {
    if (cancellingId) return false;
    if (!item.listingNonce || !item.listingOutpoint || !item.listingBeef || !item.tokenTxid) {
      toast.error("This listing can't be cancelled automatically (missing listing data)", {
        duration: 5000, position: "top-center", id: "cancel-error",
      });
      return false;
    }

    setCancellingId(item._id);
    try {
      if (!userWallet) {
        try {
          await initializeWallet();
        } catch (e) {
          console.error("Failed to initialize wallet:", e);
          toast.error("Failed to connect wallet", { duration: 5000, position: "top-center", id: "wallet-connect-error" });
          return false;
        }
      }
      if (!userPubKey) {
        toast.error("Failed to get public key", { duration: 5000, position: "top-center", id: "public-key-error" });
        return false;
      }

      const listingOutpoint = item.listingOutpoint;
      const { vout: listingVout } = parseOutpoint(listingOutpoint);

      // Source tx for the listing multisig output (from the backed-up BEEF).
      const fullListingTx = Transaction.fromBEEF(decodeBeef(item.listingBeef));
      // Token amount carried by the multisig output (amount=0 => full balance of that output).
      const shares = await calcTokenTransfer(fullListingTx, listingVout, 0);

      // Derive both multisig child keys (seller signs with sellerChild; serverChild rebuilds the script).
      const { selfKey: sellerChild, counterpartyKey: serverChild } = await deriveMultisigPair(
        userWallet!, SERVER_IDENTITY_KEY, item.listingNonce,
      );

      // Reclaim output: seller's own derived P2PKH (fresh nonce) — same shape as any held share.
      const cancelNonce = generateNonce();
      const ownKey = await deriveOwnKey(userWallet!, SERVER_IDENTITY_KEY, cancelNonce);
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
        /* counterparty */ SERVER_IDENTITY_KEY,
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
        return false;
      }

      const reference = actionRes.signableTransaction.reference;
      const txToSign = Transaction.fromBEEF(actionRes.signableTransaction.tx);
      txToSign.inputs[0].unlockingScriptTemplate = ordinalUnlockFrame;
      txToSign.inputs[0].sourceTransaction = fullListingTx;
      await txToSign.sign();
      const finalOrdinalUnlockingScript = txToSign.inputs[0].unlockingScript?.toHex();
      if (!finalOrdinalUnlockingScript) {
        toast.error("Failed to create transaction", { duration: 5000, position: "top-center", id: "cancel-error" });
        return false;
      }

      const cancelTx = await userWallet!.signAction({
        reference,
        spends: { "0": { unlockingScript: finalOrdinalUnlockingScript } },
      });
      if (!cancelTx?.txid) {
        toast.error("Failed to sign transaction", { duration: 5000, position: "top-center", id: "cancel-error" });
        return false;
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
        return false;
      }

      // Internalize the reclaimed P2PKH (output 0) into the seller's basket.
      try {
        await internalizeToBasket(
          userWallet!,
          cancelTx.tx as number[],
          [{ outputIndex: 0, keyId: cancelNonce, counterparty: SERVER_IDENTITY_KEY, tags: ["type:share"] }],
          "Reclaim listed share",
        );
      } catch (e) {
        console.error("[cancelListing] Failed to internalize reclaimed share:", e);
      }

      toast.success("Listing cancelled", { duration: 4000, position: "top-center", id: "cancel-success" });
      return true;
    } catch (e) {
      console.error("[cancelListing] Error:", e);
      toast.error("Failed to cancel listing", { duration: 5000, position: "top-center", id: "cancel-error" });
      return false;
    } finally {
      setCancellingId(null);
    }
  };

  return { cancelListing, cancellingId };
}
