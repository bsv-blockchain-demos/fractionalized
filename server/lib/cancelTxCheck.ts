import { OP, Spend } from '@bsv/sdk';
import type { Transaction, Script } from '@bsv/sdk';

// The client-built cancel tx is checked before it is recorded: its own inputs must be what
// useCancelListing + the wallet build, and they must verify. verify() costs ~1.4ms per signature
// check across the whole unmined ancestry, which the client controls, so the full walk only runs
// within a budget (real cancels: 13-29 checks on testnet).
export const MAX_FEE_INPUTS = 20;
export const MAX_UNLOCK_BYTES = 142; // 1-of-2 multisig unlock upper bound; P2PKH is 108
export const ANCESTRY_SIG_CHECK_BUDGET = 100;

const P2PKH = /^76a914[0-9a-f]{40}88ac$/;

/** Signature checks a script can run: one per CHECKSIG, one per key for CHECKMULTISIG (20 if unknown). */
export function sigChecks(script: Script): number {
  let n = 0;
  script.chunks.forEach(({ op }, i) => {
    if (op === OP.OP_CHECKSIG || op === OP.OP_CHECKSIGVERIFY) n += 1;
    if (op === OP.OP_CHECKMULTISIG || op === OP.OP_CHECKMULTISIGVERIFY) {
      const keys = script.chunks[i - 1]?.op ?? 0;
      n += keys >= OP.OP_1 && keys <= OP.OP_16 ? keys - OP.OP_1 + 1 : 20;
    }
  });
  return n;
}

/**
 * Null if the cancel's inputs are the listing plus at most MAX_FEE_INPUTS wallet P2PKH inputs,
 * each with a short push-only unlocking script; otherwise the reason.
 */
export function cancelInputsProblem(tx: Transaction, listingTxid: string, listingVout: number): string | null {
  let listingInputs = 0;
  let feeInputs = 0;
  for (const input of tx.inputs) {
    const unlock = input.unlockingScript;
    if (!unlock || !unlock.isPushOnly() || unlock.toBinary().length > MAX_UNLOCK_BYTES) {
      return 'Cancel tx has an unlocking script that is not a short push-only script';
    }
    const sourceTxid = input.sourceTXID ?? input.sourceTransaction?.id('hex');
    if (sourceTxid === listingTxid && input.sourceOutputIndex === listingVout) {
      listingInputs++;
      continue;
    }
    const lock = input.sourceTransaction?.outputs[input.sourceOutputIndex]?.lockingScript.toHex();
    if (!lock || !P2PKH.test(lock)) return 'Cancel tx has an input that is neither the listing nor a P2PKH';
    feeInputs++;
  }
  if (listingInputs !== 1) return 'Cancel tx does not spend the listing multisig';
  if (feeInputs > MAX_FEE_INPUTS) return 'Cancel tx has more fee inputs than allowed';
  return null;
}

function ancestryWithinBudget(tx: Transaction): boolean {
  let checks = 0;
  const seen = new Set<Transaction>();
  const queue = [tx];
  while (queue.length > 0) {
    const t = queue.pop()!;
    if (seen.has(t) || t.merklePath) continue;
    seen.add(t);
    for (const input of t.inputs) {
      const source = input.sourceTransaction;
      const lock = source?.outputs[input.sourceOutputIndex]?.lockingScript;
      checks += (input.unlockingScript ? sigChecks(input.unlockingScript) : 0) + (lock ? sigChecks(lock) : 0);
      if (checks > ANCESTRY_SIG_CHECK_BUDGET) return false;
      if (source) queue.push(source);
    }
  }
  return true;
}

function inputsVerify(tx: Transaction): boolean {
  return tx.inputs.every((input, i) => {
    const source = input.sourceTransaction?.outputs[input.sourceOutputIndex];
    if (!source || !input.unlockingScript) return false;
    return new Spend({
      sourceTXID: input.sourceTXID ?? input.sourceTransaction!.id('hex'),
      sourceOutputIndex: input.sourceOutputIndex,
      lockingScript: source.lockingScript,
      sourceSatoshis: source.satoshis ?? 0,
      transactionVersion: tx.version,
      otherInputs: tx.inputs.filter((_, j) => j !== i),
      unlockingScript: input.unlockingScript,
      inputSequence: input.sequence ?? 0xffffffff,
      inputIndex: i,
      outputs: tx.outputs,
      lockTime: tx.lockTime,
    }).validate();
  });
}

/**
 * Verifies the whole ancestry when it is cheap; otherwise only the cancel's own inputs, since
 * rejecting here would strand a cancel that is already broadcast. Call after cancelInputsProblem.
 */
export async function verifyCancelTx(tx: Transaction): Promise<boolean> {
  try {
    return ancestryWithinBudget(tx) ? await tx.verify('scripts only') : inputsVerify(tx);
  } catch {
    return false;
  }
}
