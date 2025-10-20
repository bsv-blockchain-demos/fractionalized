import { Hash, PublicKey } from "@bsv/sdk";

export function hashFromPubkeys(pubkeys: PublicKey[]): number[] {
    return Hash.hash160(pubkeys.reduce((a, b: PublicKey) => a.concat(b.toDER() as number[]), [] as number[]));
}