import {
    Transaction,
    Script,
    TransactionSignature,
} from "@bsv/sdk";

export function calculatePreimage(
    tx: Transaction, 
    inputIndex: number, 
    signOutputs: "all" | "none" | "single", 
    anyoneCanPay: boolean, 
    sourceSatoshis?: number, 
    lockingScript?: Script
): { preimage: number[], signatureScope: number } {
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

    return { preimage: TransactionSignature.format({
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
    }), signatureScope };
}