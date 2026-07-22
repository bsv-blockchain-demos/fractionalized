// Edge-safe config: only reads process.env, no Node-only imports.
const REQUIRED_ENV = [
  "MONGODB_URI",
  "SERVER_PRIVATE_KEY",
  "WALLET_STORAGE_URL",
  "NEXT_PUBLIC_SERVER_IDENTITY_KEY",
] as const;

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET is missing or too short (minimum 32 characters)");
  }
  return secret;
}

export function assertServerConfig(): void {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k] || String(process.env[k]).trim() === "");
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  getJwtSecret();
}
