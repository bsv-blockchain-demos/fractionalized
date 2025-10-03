// Use static access so Next.js can inline public env values in client bundles
export const SERVER_PUBKEY: string = process.env.NEXT_PUBLIC_SERVER_PUBKEY as string;

export function assertEnv(): void {
  if (!SERVER_PUBKEY || String(SERVER_PUBKEY).trim() === "") {
    throw new Error("Missing required environment variable: NEXT_PUBLIC_SERVER_PUBKEY");
  }
}
