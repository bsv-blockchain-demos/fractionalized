import { Transaction, OP, Utils } from "@bsv/sdk";

export async function calcTokenTransfer(parentTx: Transaction, amount: number) {
    const script = parentTx.outputs[0].lockingScript;
    const chunks = script.chunks;
    let parentAmount: number | undefined = undefined;
    
    if (chunks.length < 7) {
        throw new Error("Failed to get parent amount");
    }
    const inscription = Utils.toUTF8(chunks[6].data as number[]);
    const inscriptionJSON = JSON.parse(inscription);
    if (inscriptionJSON && inscriptionJSON.p === "bsv-20") {
        parentAmount = Number(inscriptionJSON.amt);
    }

    if (parentAmount === undefined) {
        throw new Error("Failed to get parent amount");
    }

    const changeAmount = parentAmount - amount;
    if (changeAmount < 0) {
        throw new Error("Not enough tokens");
    }

    return changeAmount;
}
