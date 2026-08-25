/**
 * Private data must never be cached under a key that outlives the identity: a wallet switch
 * in the same browser would otherwise serve the previous user's shares from cache.
 */
import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { qk } from '../queryKeys';

const A = '02aaaaaa';
const B = '02bbbbbb';
const PRIVATE = [qk.myShares, qk.myListings, qk.mySelling];

const params = { page: 1, limit: 20, sortBy: 'price_desc', activeStatus: 'all', filters: '{}' };

describe('query keys', () => {
  it('puts the identity first in every private key', () => {
    for (const make of PRIVATE) expect(make(A).slice(0, 2)).toEqual(['identity', A]);
  });

  it('gives two identities non-overlapping keys', () => {
    const all = PRIVATE.flatMap((make) => [JSON.stringify(make(A)), JSON.stringify(make(B))]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('drops only the named identity when its subtree is removed', () => {
    const client = new QueryClient();
    for (const make of PRIVATE) {
      client.setQueryData(make(A), ['a']);
      client.setQueryData(make(B), ['b']);
    }
    client.removeQueries({ queryKey: ['identity', B] });
    for (const make of PRIVATE) {
      // The inverse matters as much as the happy path: a test that only checks B is gone
      // still passes when the identity is dropped from the key entirely.
      expect(client.getQueryData(make(A))).toEqual(['a']);
      expect(client.getQueryData(make(B))).toBeUndefined();
    }
  });

  it('keys public reads by their inputs and nothing else', () => {
    expect(qk.property('p1')).not.toEqual(qk.property('p2'));
    expect(qk.properties(params)).not.toEqual(qk.properties({ ...params, page: 2 }));
    expect(qk.listings()).toEqual(['listings']);
  });
});
