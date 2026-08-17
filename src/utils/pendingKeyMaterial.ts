import { logger } from "@shared/logger";

/**
 * Nonce recovery record, persisted before a value-moving output is broadcast: lose the
 * nonce after broadcast and the output is unspendable by either party.
 */
export interface PendingKeyMaterial {
  id: string; // = nonce; 128-bit random, so already unique
  purpose: string;
  nonce: string;
  counterpartyIdentityKey: string;
  createdAt: number;
  txid?: string;
}

const STORAGE_KEY = "fraction:pendingKeyMaterial";

function readAll(): Record<string, PendingKeyMaterial> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    logger.warn("pendingKeyMaterial: read failed", e);
    return {};
  }
}

function writeAll(records: Record<string, PendingKeyMaterial>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (e) {
    logger.warn("pendingKeyMaterial: write failed", e);
  }
}

/** Save before broadcasting. Never throws: storage failure must not block a transaction. */
export function savePendingKeyMaterial(record: PendingKeyMaterial): void {
  try {
    const all = readAll();
    all[record.id] = record;
    writeAll(all);
  } catch (e) {
    logger.warn("pendingKeyMaterial: save failed", e);
  }
}

/** No-op if the record is gone. */
export function attachTxid(id: string, txid: string): void {
  try {
    const all = readAll();
    if (all[id]) {
      all[id] = { ...all[id], txid };
      writeAll(all);
    }
  } catch (e) {
    logger.warn("pendingKeyMaterial: attachTxid failed", e);
  }
}

/** Only after the server has the nonce. */
export function clearPendingKeyMaterial(id: string): void {
  try {
    const all = readAll();
    if (all[id]) {
      delete all[id];
      writeAll(all);
    }
  } catch (e) {
    logger.warn("pendingKeyMaterial: clear failed", e);
  }
}

/** Survivors = operations that broadcast but never confirmed. */
export function listPendingKeyMaterial(): PendingKeyMaterial[] {
  try {
    return Object.values(readAll());
  } catch (e) {
    logger.warn("pendingKeyMaterial: list failed", e);
    return [];
  }
}

/** Surface a record stuck after broadcast. */
export function logPendingKeyMaterial(record: PendingKeyMaterial, context: string): void {
  logger.error(`[pendingKeyMaterial] ${context} — recovery data (do not discard):`, {
    id: record.id, txid: record.txid, nonce: record.nonce, purpose: record.purpose,
  });
}
