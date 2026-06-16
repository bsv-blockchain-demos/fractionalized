import { Utils, Random } from '@bsv/sdk';
import type { WalletProtocol, WalletInterface } from '@bsv/sdk';

/** App-wide signing protocol for token outputs. Security level 2 = counterparty-bound. */
export const TOKEN_PROTOCOL: WalletProtocol = [2, 'fractionalized token'];

export interface Derivation {
  protocolID: WalletProtocol;
  keyID: string;
  counterparty: string; // identity public key hex, or the literal 'self'
}

/** Fresh per-output nonce: base64 of 16 random bytes. */
export function generateNonce(): string {
  return Utils.toBase64(Random(16));
}

/** The server's root identity public key (counterparty value the other side derives against). */
export async function getIdentityKey(wallet: WalletInterface): Promise<string> {
  const { publicKey } = await wallet.getPublicKey({ identityKey: true });
  return publicKey;
}

/** Lock key for a recipient (you're the sender); only they can derive the matching private key. */
export async function deriveRecipientKey(
  senderWallet: WalletInterface,
  recipientIdentityKey: string,
  nonce: string,
): Promise<string> {
  const { publicKey } = await senderWallet.getPublicKey({
    protocolID: TOKEN_PROTOCOL, keyID: nonce, counterparty: recipientIdentityKey, forSelf: false,
  });
  return publicKey;
}

/**
 * Derive BOTH child public keys for a 1-of-2 multisig(self + party) at one nonce.
 * `selfKey` is yours (you can sign with it); `counterpartyKey` is the other party's
 * (needed to rebuild the script hash at spend time).
 */
export async function deriveMultisigPair(
  wallet: WalletInterface,
  partyIdentityKey: string,
  nonce: string,
): Promise<{ selfKey: string; counterpartyKey: string }> {
  const { publicKey: selfKey } = await wallet.getPublicKey({
    protocolID: TOKEN_PROTOCOL, keyID: nonce, counterparty: partyIdentityKey, forSelf: true,
  });
  const { publicKey: counterpartyKey } = await wallet.getPublicKey({
    protocolID: TOKEN_PROTOCOL, keyID: nonce, counterparty: partyIdentityKey, forSelf: false,
  });
  return { selfKey, counterpartyKey };
}
