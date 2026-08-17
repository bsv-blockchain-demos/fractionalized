// Public, client-safe values only. NEVER add a server secret here — Vite inlines
// every VITE_* var into the public bundle.

/** Server root identity key — type-42 counterparty for every derived output, and the auth-proof server id. */
export const SERVER_IDENTITY_KEY: string = import.meta.env.VITE_SERVER_IDENTITY_KEY as string;

/**
 * Call once at boot. Missing SERVER_IDENTITY_KEY makes every type-42 derivation use
 * `undefined` as counterparty, producing outputs neither side can re-derive — the
 * unspendable-output failure of finding C-5. Fail loudly instead.
 */
export function assertEnv(): void {
  if (!SERVER_IDENTITY_KEY || SERVER_IDENTITY_KEY.trim() === "") {
    throw new Error("Missing required environment variable: VITE_SERVER_IDENTITY_KEY");
  }
}
