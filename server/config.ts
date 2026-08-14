// The single source of validated env/secrets for the server. SERVER-ONLY —
// never import this from client code (it would bundle secrets into the browser build).
import dotenv from 'dotenv';
// Server env lives ONLY in server/.env. Root .env is the client's (NEXT_PUBLIC_*/VITE_*)
// and must never be read here. No-op when absent; in prod the host env is already set.
dotenv.config({ path: 'server/.env' });

export {
  getJwtSecret,
  getServerPrivateKey,
  getWalletStorageUrl,
  getMongoUri,
  getMinBalance,
  assertServerConfig,
} from '../src/lib/config';

export function getPort(): number {
  return Number(process.env.PORT) || 3001;
}

/** Credentialed cross-origin allowlist. Empty = same-origin only. */
export function getAllowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}
