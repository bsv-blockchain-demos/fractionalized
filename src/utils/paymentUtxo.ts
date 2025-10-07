import {
  OP,
  LockingScript,
  TransactionSignature,
  UnlockingScript,
  PublicKey,
  Signature,
  ScriptTemplate,
  WalletInterface,
  Transaction,
  Script,
  Hash,
} from "@bsv/sdk";

export class PaymentUtxo implements ScriptTemplate {
  lock(oneOfTwoHash: number[]) {
    const paymentLockingScript = new LockingScript();
    paymentLockingScript
      .writeOpCode(OP.OP_2DUP)
      .writeOpCode(OP.OP_CAT)
      .writeOpCode(OP.OP_HASH160)
      .writeBin(oneOfTwoHash)
      .writeOpCode(OP.OP_EQUALVERIFY)
      .writeOpCode(OP.OP_TOALTSTACK)
      .writeOpCode(OP.OP_TOALTSTACK)
      .writeOpCode(OP.OP_1)
      .writeOpCode(OP.OP_FROMALTSTACK)
      .writeOpCode(OP.OP_FROMALTSTACK)
      .writeOpCode(OP.OP_2)
      .writeOpCode(OP.OP_CHECKMULTISIG);

    return paymentLockingScript;
  }

  unlock(
    wallet: WalletInterface,
    signOutputs: "all" | "none" | "single" = "all",
    anyoneCanPay = false,
    sourceSatoshis?: number,
    lockingScript?: Script,
    counterpartyPubkey?: string,
    firstPubkeyIsWallet: boolean = true,
  ): {
    sign: (tx: Transaction, inputIndex: number) => Promise<UnlockingScript>;
    estimateLength: () => Promise<number>;
  } {
    return {
      sign: async (tx: Transaction, inputIndex: number) => {
        let signatureScope = TransactionSignature.SIGHASH_FORKID;
        if (signOutputs === "all") signatureScope |= TransactionSignature.SIGHASH_ALL;
        if (signOutputs === "none") signatureScope |= TransactionSignature.SIGHASH_NONE;
        if (signOutputs === "single") signatureScope |= TransactionSignature.SIGHASH_SINGLE;
        if (anyoneCanPay) signatureScope |= TransactionSignature.SIGHASH_ANYONECANPAY;

        const input = tx.inputs[inputIndex];
        const otherInputs = tx.inputs.filter((_, i) => i !== inputIndex);

        const sourceTXID = input.sourceTXID || input.sourceTransaction?.id("hex");
        if (!sourceTXID) throw new Error("sourceTXID or sourceTransaction required for signing");

        sourceSatoshis ||= input.sourceTransaction?.outputs[input.sourceOutputIndex].satoshis;
        if (!sourceSatoshis) throw new Error("sourceSatoshis or input sourceTransaction required for signing");

        lockingScript ||= input.sourceTransaction?.outputs[input.sourceOutputIndex].lockingScript;
        if (!lockingScript) throw new Error("lockingScript or input sourceTransaction required for signing");

        const preimage = TransactionSignature.format({
          sourceTXID,
          sourceOutputIndex: input.sourceOutputIndex,
          sourceSatoshis,
          transactionVersion: tx.version,
          otherInputs,
          inputIndex,
          outputs: tx.outputs,
          inputSequence: input.sequence || 0xffffffff,
          subscript: lockingScript,
          lockTime: tx.lockTime,
          scope: signatureScope,
        });

        // BRC-29 pattern
        const { signature } = await wallet.createSignature({
          hashToDirectlySign: Hash.sha256(Hash.sha256(preimage)),
          protocolID: [0, "fractionalized"],
          keyID: "0",
          counterparty: "self",
        });

        const { publicKey } = await wallet.getPublicKey({
          protocolID: [0, "fractionalized"],
          keyID: "0",
          counterparty: "self",
        });

        const raw = Signature.fromDER(signature, "hex");
        const sig = new TransactionSignature(raw.r, raw.s, signatureScope);

        const unlockScript = new UnlockingScript();
        // Multisig: push OP_0, then sig, then two pubkeys to match the committed hash
        unlockScript.writeOpCode(OP.OP_0);
        unlockScript.writeBin(sig.toChecksigFormat());
        if (!counterpartyPubkey) throw new Error("counterpartyPubkey required for PaymentUtxo.unlock");
        const selfKey = PublicKey.fromString(publicKey).encode(true) as number[];
        const otherKey = PublicKey.fromString(counterpartyPubkey).encode(true) as number[];
        if (firstPubkeyIsWallet) {
          unlockScript.writeBin(selfKey);
          unlockScript.writeBin(otherKey);
        } else {
          unlockScript.writeBin(otherKey);
          unlockScript.writeBin(selfKey);
        }

        return unlockScript;
      },
      estimateLength: async () => 142, // OP_0 + sig push + two compressed pubkeys
    };
  }
}