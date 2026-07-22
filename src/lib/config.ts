// Edge-safe config: only reads process.env, no Node-only imports.
const REQUIRED_ENV = [
  "MONGODB_URI",
  "SERVER_PRIVATE_KEY",
  "WALLET_STORAGE_URL",
  "NEXT_PUBLIC_SERVER_IDENTITY_KEY",
] as const;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET is missing or too short (minimum 32 characters)");
  }
  return secret;
}

export function getServerPrivateKey(): string {
  return requireEnv("SERVER_PRIVATE_KEY");
}

export function getWalletStorageUrl(): string {
  return requireEnv("WALLET_STORAGE_URL");
}

export function getMongoUri(): string {
  return requireEnv("MONGODB_URI");
}

export function getMinBalance(): number {
  const raw = process.env.MIN_BALANCE;
  const n = Number(raw);
  if (raw == null || raw.trim() === "" || !Number.isFinite(n)) {
    throw new Error("MIN_BALANCE is missing or not a number");
  }
  return n;
}

export function assertServerConfig(): void {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k] || String(process.env[k]).trim() === "");
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  getJwtSecret();
}
