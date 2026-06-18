// src/utils/internalizeToBasket.ts
import type { WalletInterface } from '@bsv/sdk';
import { TOKEN_PROTOCOL } from './tokenDerivation';

export const TOKEN_BASKET = 'fractionalized.tokens';

export interface ReceivedOutput {
  outputIndex: number;
  keyId: string;        // nonce used to lock this output
  counterparty: string; // identity key the output was locked toward (or 'self')
  /** For multisig outputs: the OTHER party's derived pubkey, needed to rebuild the script. */
  counterpartyDerivedKey?: string;
  /** For multisig outputs: 'self-first' | 'self-second' — position of this wallet's key in the committed concat. */
  order?: 'self-first' | 'self-second';
  tags?: string[];
}

/** Record an existing tx's outputs into the owner's basket, storing each nonce in customInstructions. Does not broadcast. */
export async function internalizeToBasket(
  wallet: WalletInterface,
  atomicBeef: number[],
  outputs: ReceivedOutput[],
  description: string,
): Promise<void> {
  await wallet.internalizeAction({
    tx: atomicBeef,
    description,
    outputs: outputs.map((o) => ({
      outputIndex: o.outputIndex,
      protocol: 'basket insertion' as const,
      insertionRemittance: {
        basket: TOKEN_BASKET,
        customInstructions: JSON.stringify({
          protocol: TOKEN_PROTOCOL,
          keyId: o.keyId,
          counterparty: o.counterparty,
          counterpartyDerivedKey: o.counterpartyDerivedKey,
          order: o.order,
        }),
        tags: o.tags,
      },
    })),
  });
}
