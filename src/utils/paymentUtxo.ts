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
  ScriptChunk,
} from "@bsv/sdk";
import { calculatePreimage } from "./preimage";

export class PaymentUtxo implements ScriptTemplate {

  static hashFromPubkeys(pubkeys: PublicKey[]): number[] {
    return Hash.hash160(pubkeys.reduce((a, b: PublicKey) => a.concat(b.toDER() as number[]), [] as number[]));
  }

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
    otherPubkey: string, //  the non-wallet pubkey
    signOutputs: "all" | "none" | "single" = "all",
    anyoneCanPay = false,
    sourceSatoshis?: number,
    lockingScript?: Script,
    firstPubkeyIsWallet: boolean = true,
  ): {
    sign: (tx: Transaction, inputIndex: number) => Promise<UnlockingScript>;
    estimateLength: () => Promise<number>;
  } {
    return {
      sign: async (tx: Transaction, inputIndex: number) => {
        const { preimage, signatureScope } = calculatePreimage(tx, inputIndex, signOutputs, anyoneCanPay, sourceSatoshis, lockingScript);

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
        unlockScript.writeBin(PublicKey.fromString(publicKey).encode(true) as number[]);
        unlockScript.writeBin(PublicKey.fromString(otherPubkey).encode(true) as number[]);
        if (!firstPubkeyIsWallet) {
          // reverse the order of the last two script chunks
          const lastChunk = unlockScript.chunks.pop() as ScriptChunk;
          const secondLastChunk = unlockScript.chunks.pop() as ScriptChunk;
          unlockScript.chunks.push(lastChunk, secondLastChunk);
        } 

        return unlockScript;
      },
      estimateLength: async () => 142, // OP_0 + sig push + two compressed pubkeys
    };
  }
}