// The single source of validated env/secrets for the server. SERVER-ONLY —
// never import this from client code (it would bundle secrets into the browser build).
import dotenv from 'dotenv';
// Server env lives ONLY in server/.env. Root .env is the client's (NEXT_PUBLIC_*/VITE_*)
// and must never be read here. No-op when absent; in prod the host env is already set.
dotenv.config({ path: 'server/.env' });

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET is missing or too short (minimum 32 characters)');
  }
  return secret;
}

export function getServerPrivateKey(): string {
  return requireEnv('SERVER_PRIVATE_KEY');
}

export function getWalletStorageUrl(): string {
  return requireEnv('WALLET_STORAGE_URL');
}

export function getMongoUri(): string {
  return requireEnv('MONGODB_URI');
}

export function getMinBalance(): number {
  const raw = process.env.MIN_BALANCE;
  const n = Number(raw);
  if (raw == null || raw.trim() === '' || !Number.isFinite(n)) {
    throw new Error('MIN_BALANCE is missing or not a number');
  }
  return n;
}

export function getPort(): number {
  return Number(process.env.PORT) || 3001;
}

/** Credentialed cross-origin allowlist. Empty = same-origin only. */
export function getAllowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}
