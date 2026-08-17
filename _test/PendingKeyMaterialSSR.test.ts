// Plain node environment (this project's jest default) — `window` genuinely doesn't
// exist here, unlike jsdom where it's a non-configurable global that can't be deleted.
// This is what SSR module evaluation actually looks like.
import {
  savePendingKeyMaterial,
  attachTxid,
  clearPendingKeyMaterial,
  listPendingKeyMaterial,
} from '@/utils/pendingKeyMaterial';

describe('pendingKeyMaterial without window (SSR)', () => {
  test('all operations are no-ops that never throw', () => {
    expect(typeof window).toBe('undefined');

    expect(() => savePendingKeyMaterial({
      id: 'n', purpose: 'create-property', nonce: 'n',
      counterpartyIdentityKey: '02aa', createdAt: Date.now(),
    })).not.toThrow();
    expect(() => attachTxid('n', 'deadbeef.0')).not.toThrow();
    expect(() => clearPendingKeyMaterial('n')).not.toThrow();
    expect(listPendingKeyMaterial()).toEqual([]);
  });
});
