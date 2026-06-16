// src/lib/tokenIndex.ts
import type { Collection } from 'mongodb';

export interface TokenDerivationRecord {
  keyId: string;
  counterparty: string;
  counterpartyDerivedKey?: string;      // multisig only
  order?: 'self-first' | 'self-second'; // multisig only
}

/** Persist a token's derivation on its DB record. `filter` must match one document. */
export async function recordTokenDerivation(
  collection: Collection<any>,
  filter: Record<string, unknown>,
  d: TokenDerivationRecord,
): Promise<void> {
  await collection.updateOne(filter, {
    $set: { keyId: d.keyId, counterparty: d.counterparty, counterpartyDerivedKey: d.counterpartyDerivedKey, order: d.order },
  });
}

/** Read a token's derivation by an outpoint field; null when no nonce recorded (legacy → caller uses legacy unlock). */
export async function getTokenDerivation(
  collection: Collection<any>,
  outpointField: string,
  outpoint: string,
): Promise<TokenDerivationRecord | null> {
  const doc = await collection.findOne({ [outpointField]: outpoint });
  if (!doc || !doc.keyId) return null;
  return { keyId: doc.keyId, counterparty: doc.counterparty, counterpartyDerivedKey: doc.counterpartyDerivedKey, order: doc.order };
}
