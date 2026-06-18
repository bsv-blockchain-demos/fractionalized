// src/utils/reindexFromBasket.ts
import type { WalletInterface } from '@bsv/sdk';
import { TOKEN_BASKET } from './internalizeToBasket';

export interface IndexedOutput {
  outpoint: string;
  satoshis: number;
  keyId: string;
  counterparty: string;
  counterpartyDerivedKey?: string;
  order?: 'self-first' | 'self-second';
}

/** Rebuild derivation records from a wallet basket's customInstructions. Recovery/admin only. */
export async function reindexFromBasket(wallet: WalletInterface, tags?: string[]): Promise<IndexedOutput[]> {
  const res = await wallet.listOutputs({ basket: TOKEN_BASKET, tags, includeCustomInstructions: true });
  return (res.outputs ?? []).flatMap((o: any) => {
    if (!o.customInstructions) return [];
    const ci = JSON.parse(o.customInstructions);
    return [{ outpoint: o.outpoint, satoshis: o.satoshis, keyId: ci.keyId, counterparty: ci.counterparty, counterpartyDerivedKey: ci.counterpartyDerivedKey, order: ci.order }];
  });
}
