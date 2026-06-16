// src/utils/fetchTokenSourceTx.ts
import { Transaction } from '@bsv/sdk';
import { getTransactionByTxID } from '../hooks/overlayFunctions';
import { decodeBeef } from './beefEncoding';

/**
 * Resolve a source transaction for spending an outpoint.
 * Prefers a caller-supplied base64 BEEF (DB carry-forward / listing_beefs);
 * falls back to the overlay by txid. Throws if neither resolves.
 */
export async function fetchTokenSourceTx(outpoint: string, storedBeefBase64?: string): Promise<Transaction> {
  if (storedBeefBase64) {
    return Transaction.fromBEEF(decodeBeef(storedBeefBase64));
  }
  const txid = outpoint.split(/[._]/)[0];
  const ov = await getTransactionByTxID(txid);
  const beef = ov?.outputs?.[0]?.beef;
  if (beef) return Transaction.fromBEEF(beef as number[]);
  throw new Error(`Could not resolve source tx for ${outpoint} (no stored BEEF and overlay miss)`);
}
