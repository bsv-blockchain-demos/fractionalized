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

const serverPubkey = process.env.NEXT_PUBLIC_SERVER_PUBKEY;

export class Ordinals implements ScriptTemplate {
    lock(
        address: string, // Just pubkey of user to send token to
        assetId: string, // AssetID = txid_vout
        tokenTxid: string, // Txid where the property token was created
        shares: number,
        type: "deploy+mint" | "transfer",
        isFirst?: boolean,
        serverChange?: boolean
    ): LockingScript {
        const pubKeyHash = Hash.hash160(address, "hex");
        let inscription: any;
        if (type === "deploy+mint" && isFirst) {
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
        if (isFirst) {
            const oneOfTwoHash = Hash.hash160(serverPubkey + address, "hex");

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
        } else if (serverChange) {
            const oneOfTwoHash = Hash.hash160(serverPubkey + address, "hex");

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
        }
        else {
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
                .writeBin(Utils.toArray(tokenTxid, "hex"));
        }

        return lockingScript;
    }

    unlock(
        wallet: WalletInterface,
        signOutputs: "all" | "none" | "single" = "all",
        anyoneCanPay = false,
        sourceSatoshis?: number,
        lockingScript?: Script,
        isFirst?: boolean,
        sellerPubkey?: string
    ): {
        sign: (tx: Transaction, inputIndex: number) => Promise<UnlockingScript>;
        estimateLength: () => Promise<number>;
    } {
        return {
            sign: async (tx: Transaction, inputIndex: number) => {
                let signatureScope = TransactionSignature.SIGHASH_FORKID;
                if (signOutputs === "all") {
                    signatureScope |= TransactionSignature.SIGHASH_ALL;
                }
                if (signOutputs === "none") {
                    signatureScope |= TransactionSignature.SIGHASH_NONE;
                }
                if (signOutputs === "single") {
                    signatureScope |= TransactionSignature.SIGHASH_SINGLE;
                }
                if (anyoneCanPay) {
                    signatureScope |= TransactionSignature.SIGHASH_ANYONECANPAY;
                }

                const input = tx.inputs[inputIndex];

                const otherInputs = tx.inputs.filter(
                    (_, index) => index !== inputIndex
                );

                const sourceTXID = input.sourceTXID
                    ? input.sourceTXID
                    : input.sourceTransaction?.id("hex");
                if (!sourceTXID) {
                    throw new Error(
                        "The input sourceTXID or sourceTransaction is required for transaction signing."
                    );
                }
                sourceSatoshis ||=
                    input.sourceTransaction?.outputs[input.sourceOutputIndex].satoshis;
                if (!sourceSatoshis) {
                    throw new Error(
                        "The sourceSatoshis or input sourceTransaction is required for transaction signing."
                    );
                }
                lockingScript ||=
                    input.sourceTransaction?.outputs[input.sourceOutputIndex]
                        .lockingScript;
                if (!lockingScript) {
                    throw new Error(
                        "The lockingScript or input sourceTransaction is required for transaction signing."
                    );
                }

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

                // include the pattern from BRC-29
                const { signature } = await wallet.createSignature({
                    hashToDirectlySign: Hash.sha256(Hash.sha256(preimage)),
                    protocolID: [0, "ordinals"],
                    keyID: "0",
                    counterparty: 'self'
                })

                console.log({ signature })

                const { publicKey } = await wallet.getPublicKey({
                    protocolID: [0, "ordinals"],
                    keyID: "0",
                    counterparty: 'self'
                })

                const rawSignature = Signature.fromDER(signature, 'hex')
                const sig = new TransactionSignature(
                    rawSignature.r,
                    rawSignature.s,
                    signatureScope
                );
                const unlockScript = new UnlockingScript();
                if (isFirst && sellerPubkey) {
                    // If first ordinal child connect with serverWallet (multisig script)
                    unlockScript.writeOpCode(OP.OP_0)
                    unlockScript.writeBin(sig.toChecksigFormat());
                    unlockScript.writeBin(
                        PublicKey.fromString(publicKey).encode(true) as number[]
                    );
                    unlockScript.writeBin(
                        PublicKey.fromString(sellerPubkey).encode(true) as number[]
                    );
                } else {
                    // If not first ordinal child connect with userWallet (single signature script)
                    unlockScript.writeBin(sig.toChecksigFormat());
                    unlockScript.writeBin(
                        PublicKey.fromString(publicKey).encode(true) as number[]
                    );
                }

                return unlockScript;
            },
            estimateLength: async () => {
                // public key (1+33) + signature (1+73)
                // Note: We add 1 to each element's length because of the associated OP_PUSH
                if (isFirst) return 142;
                return 108;
            },
        }
    }
}