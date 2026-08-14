import {
     LockingScript,
     ScriptTemplate,
     Transaction,
     UnlockingScript,
     Hash,
     OP,
     Utils,
     WalletInterface,
     Script,
     TransactionSignature,
     Signature,
     PublicKey
 } from "@bsv/sdk";
import { calculatePreimage } from "./preimage";
import type { Derivation } from "./tokenDerivation";

const LEGACY_DERIVATION: Derivation = { protocolID: [0, "fractionalized"], keyID: "0", counterparty: "self" };

export class OrdinalsP2PKH implements ScriptTemplate {

    lock(
        address: string | number[], // Just pubkeyhash of user to send token to
        assetId: string, // AssetID = txid_vout
        tokenTxid: string, // Txid where the property token was created
        shares: number,
        type: "deploy+mint" | "transfer"
    ): LockingScript {
        let pubKeyHash: number[];
        if (typeof address === "string") {
            pubKeyHash = Utils.fromBase58Check(address).data as number[];
        } else {
            pubKeyHash = address;
        }

        let inscription: any;
        if (type === "deploy+mint") {
            inscription = {
                p: "bsv-20",
                op: type,
                amt: String(shares),
            }
        } else {
            inscription = {
                p: "bsv-20",
                op: type,
                amt: String(shares),
                id: assetId,
            }
        }

        const jsonString = JSON.stringify(inscription);
        const lockingScript = new LockingScript();
        lockingScript
            // Write inscription
            .writeOpCode(OP.OP_0)
            .writeOpCode(OP.OP_IF)
            .writeBin(Utils.toArray('ord', 'utf8'))
            .writeOpCode(OP.OP_1)
            .writeBin(Utils.toArray('application/bsv-20', 'utf8'))
            .writeOpCode(OP.OP_0)
            .writeBin(Utils.toArray(jsonString, 'utf8'))
            .writeOpCode(OP.OP_ENDIF)
            // Write single signature lockingScript
            .writeOpCode(OP.OP_DUP)
            .writeOpCode(OP.OP_HASH160)
            .writeBin(pubKeyHash)
            .writeOpCode(OP.OP_EQUALVERIFY)
            .writeOpCode(OP.OP_CHECKSIG)
            .writeOpCode(OP.OP_RETURN)
            // OP_RETURN identifier: property outpoint as txid_vout (utf8)
            .writeBin(Utils.toArray(tokenTxid.replace(/\./g, "_"), "utf8"));

        return lockingScript;
    }

    unlock(
        wallet: WalletInterface,
        signOutputs: "all" | "none" | "single" = "all",
        anyoneCanPay = false,
        sourceSatoshis?: number,
        lockingScript?: Script,
        derivation: Derivation = LEGACY_DERIVATION,
    ): {
        sign: (tx: Transaction, inputIndex: number) => Promise<UnlockingScript>;
        estimateLength: () => Promise<number>;
    } {
        return {
            sign: async (tx: Transaction, inputIndex: number) => {
                const { preimage, signatureScope } = calculatePreimage(tx, inputIndex, signOutputs, anyoneCanPay, sourceSatoshis, lockingScript);
                const { signature } = await wallet.createSignature({
                    hashToDirectlySign: Hash.hash256(preimage),
                    protocolID: derivation.protocolID, keyID: derivation.keyID, counterparty: derivation.counterparty,
                })
                const { publicKey } = await wallet.getPublicKey({
                    protocolID: derivation.protocolID, keyID: derivation.keyID,
                    counterparty: derivation.counterparty, forSelf: derivation.counterparty !== 'self',
                })
                const rawSignature = Signature.fromDER(signature, 'hex')
                const sig = new TransactionSignature(rawSignature.r, rawSignature.s, signatureScope);
                const unlockScript = new UnlockingScript();
                unlockScript.writeBin(sig.toChecksigFormat());
                unlockScript.writeBin(PublicKey.fromString(publicKey).encode(true) as number[]);
                return unlockScript;
            },
            estimateLength: async () => 108,
        }
    }
}