/**
 * @vitest-environment node
 *
 * MUST stay on the node environment: `window` genuinely doesn't exist here, unlike
 * jsdom where it's a non-configurable global that can't be deleted. Under the
 * workspace's jsdom default this file would still pass while testing nothing.
 */
import { describe, test, expect } from 'vitest';
import {
  savePendingKeyMaterial,
  attachTxid,
  clearPendingKeyMaterial,
  listPendingKeyMaterial,
} from '@/lib/pendingKeyMaterial';

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
