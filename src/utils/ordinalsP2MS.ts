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
     PublicKey,
     ScriptChunk
 } from "@bsv/sdk";
import { calculatePreimage } from "./preimage";

export class OrdinalsP2MS implements ScriptTemplate {

    static hashFromPubkeys(pubkeys: PublicKey[]): number[] {
        return Hash.hash160(pubkeys.reduce((a, b: PublicKey) => a.concat(b.toDER() as number[]), [] as number[]));
    }

    lock(
        oneOfTwoHash: number[], // concat pubkeys hash
        assetId: string, // AssetID = txid_vout
        tokenTxid: string, // Txid where the property token was created
        shares: number,
        type: "deploy+mint" | "transfer"
    ): LockingScript {
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
                // Write 1 of 2 multisig lockingScript
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
                .writeOpCode(OP.OP_CHECKMULTISIG)
                .writeOpCode(OP.OP_RETURN)
                .writeBin(Utils.toArray(tokenTxid, "hex"));
        
        return lockingScript;
    }

    unlock(
        wallet: WalletInterface,
        keyID: string,
        counterparty: string,
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

                // include the pattern from BRC-29
                const { signature } = await wallet.createSignature({
                    hashToDirectlySign: Hash.hash256(preimage),
                    protocolID: [0, "fractionalized"],
                    keyID,
                    counterparty
                })

                console.log({ signature })

                const { publicKey } = await wallet.getPublicKey({
                    protocolID: [0, "fractionalized"],
                    keyID,
                    counterparty,
                    forSelf: true
                })

                console.log({ 'wallet.getPublicKey': publicKey })

                const rawSignature = Signature.fromDER(signature, 'hex')
                const sig = new TransactionSignature(
                    rawSignature.r,
                    rawSignature.s,
                    signatureScope
                );
                const unlockScript = new UnlockingScript();
                // If first ordinal child connect with serverWallet (multisig script)
                unlockScript.writeOpCode(OP.OP_0)
                unlockScript.writeBin(sig.toChecksigFormat());
                unlockScript.writeBin(
                    PublicKey.fromString(publicKey).encode(true) as number[]
                );
                unlockScript.writeBin(
                    PublicKey.fromString(otherPubkey).encode(true) as number[]
                );
                if (!firstPubkeyIsWallet) {
                    // reverse the order of the last two script chunks
                    const lastChunk = unlockScript.chunks.pop() as ScriptChunk;
                    const secondLastChunk = unlockScript.chunks.pop() as ScriptChunk;
                    unlockScript.chunks.push(lastChunk, secondLastChunk);
                }

                return unlockScript;
            },
            estimateLength: async () => 142,
        }
    }
}