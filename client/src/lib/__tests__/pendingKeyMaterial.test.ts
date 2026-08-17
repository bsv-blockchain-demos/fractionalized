import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  savePendingKeyMaterial,
  attachTxid,
  clearPendingKeyMaterial,
  listPendingKeyMaterial,
  logPendingKeyMaterial,
  type PendingKeyMaterial,
} from '@/lib/pendingKeyMaterial';
import { logger } from '@shared/logger';

function record(overrides: Partial<PendingKeyMaterial> = {}): PendingKeyMaterial {
  return {
    id: 'nonce-a',
    purpose: 'create-property',
    nonce: 'nonce-a',
    counterpartyIdentityKey: '02'.padEnd(66, 'a'),
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('pendingKeyMaterial', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  test('save -> list -> clear roundtrip', () => {
    const r = record();
    savePendingKeyMaterial(r);

    expect(listPendingKeyMaterial()).toEqual([r]);

    clearPendingKeyMaterial(r.id);
    expect(listPendingKeyMaterial()).toEqual([]);
  });

  test('attachTxid updates the stored record in place', () => {
    const r = record();
    savePendingKeyMaterial(r);

    attachTxid(r.id, 'deadbeef.0');

    expect(listPendingKeyMaterial()).toEqual([{ ...r, txid: 'deadbeef.0' }]);
  });

  test('attachTxid on an unknown id is a no-op', () => {
    attachTxid('missing', 'deadbeef.0');
    expect(listPendingKeyMaterial()).toEqual([]);
  });

  test('clear removes only the target record, others survive', () => {
    const a = record({ id: 'a', nonce: 'a' });
    const b = record({ id: 'b', nonce: 'b' });
    savePendingKeyMaterial(a);
    savePendingKeyMaterial(b);

    clearPendingKeyMaterial('a');

    expect(listPendingKeyMaterial()).toEqual([b]);
  });

  test('clearing an unknown id does not throw and leaves existing records intact', () => {
    const a = record({ id: 'a', nonce: 'a' });
    savePendingKeyMaterial(a);

    expect(() => clearPendingKeyMaterial('does-not-exist')).not.toThrow();
    expect(listPendingKeyMaterial()).toEqual([a]);
  });

  test('save does not throw and does not block when localStorage.setItem throws (e.g. quota/private mode)', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    expect(() => savePendingKeyMaterial(record())).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
  });

  test('list does not throw and returns [] when localStorage.getItem throws', () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(() => listPendingKeyMaterial()).not.toThrow();
    expect(listPendingKeyMaterial()).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });

  test('logPendingKeyMaterial logs id, txid and nonce via the shared logger', () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const r = { ...record(), txid: 'deadbeef.0' };

    logPendingKeyMaterial(r, 'server update failed');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('server update failed'),
      expect.objectContaining({ id: r.id, txid: r.txid, nonce: r.nonce }),
    );
  });
});
