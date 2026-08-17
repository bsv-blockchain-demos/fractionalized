import type { WalletInterface } from "@bsv/sdk";
import { authClient } from "@shared/authProof";
import { SERVER_IDENTITY_KEY } from "./env";
import { apiFetchNoRedirect } from "./apiFetch";

/**
 * POST `url` with a fresh single-use signed auth proof bound to the caller's identity key.
 *
 * Deliberately uses apiFetchNoRedirect: these are the value-moving calls, so the caller
 * may already have broadcast an output whose nonce lives only in this page. A 401
 * hard-navigate would take the recovery data with it (finding C-5) — return the response
 * and let the caller surface it.
 */
export async function apiFetchStepUp(
  url: string,
  wallet: WalletInterface,
  purpose: string,
  body: Record<string, unknown> = {},
): Promise<Response> {
  const { publicKey: walletIdentityKey } = await wallet.getPublicKey({ identityKey: true });
  const proof = await authClient.createAuthProof(wallet, SERVER_IDENTITY_KEY, purpose);
  return apiFetchNoRedirect(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, proof, walletIdentityKey }),
  });
}
