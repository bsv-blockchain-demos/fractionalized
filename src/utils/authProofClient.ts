import type { WalletInterface } from "@bsv/sdk";
import { authClient } from "../lib/authProof";
import { SERVER_IDENTITY_KEY } from "./env";
import { apiFetch } from "./apiFetch";

/** POST `url` with a fresh single-use signed auth proof bound to the caller's identity key. */
export async function fetchWithAuthProof(
  url: string,
  wallet: WalletInterface,
  purpose: string,
  body: Record<string, unknown> = {},
): Promise<Response> {
  const { publicKey: walletIdentityKey } = await wallet.getPublicKey({ identityKey: true });
  const proof = await authClient.createAuthProof(wallet, SERVER_IDENTITY_KEY, purpose);
  return apiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, proof, walletIdentityKey }),
  });
}
