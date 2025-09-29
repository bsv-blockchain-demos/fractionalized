import { OP, LockingScript, TransactionSignature, UnlockingScript, PublicKey } from "@bsv/sdk";

export class PaymentUTXO {
    lock(oneOfTwoHash: number[]) {
        const paymentLockingScript = new LockingScript();
            paymentLockingScript
                .writeOpCode(OP.OP_1)
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

        return paymentLockingScript;
    }
    unlock(sig: TransactionSignature, userPubKey: string, SERVER_PUBKEY: string) {
        const paymentUnlockingScript = new UnlockingScript();
        paymentUnlockingScript
            .writeBin(sig.toChecksigFormat())
            .writeBin(PublicKey.fromString(SERVER_PUBKEY).encode(true) as number[])
            .writeBin(PublicKey.fromString(userPubKey).encode(true) as number[]);
        return paymentUnlockingScript;
    }
}