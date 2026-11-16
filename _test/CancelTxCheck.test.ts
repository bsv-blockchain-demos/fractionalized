import { LockingScript } from '@bsv/sdk';
import { sigChecks } from '@server/lib/cancelTxCheck';
import { OrdinalsP2MS } from '@shared/bsv/ordinalsP2MS';
import { OrdinalsP2PKH } from '@shared/bsv/ordinalsP2PKH';

test('counts the signature checks of the app scripts', () => {
  const hash = new Array(20).fill(0xab);
  expect(sigChecks(new OrdinalsP2MS().lock(hash, 'a_0', 'b_0', 1, 'transfer'))).toBe(2); // 1-of-2: one per key
  expect(sigChecks(new OrdinalsP2PKH().lock(hash, 'a_0', 'b_0', 1, 'transfer'))).toBe(1);
  expect(sigChecks(LockingScript.fromHex('6ead'.repeat(3) + 'ac'))).toBe(4);
  expect(sigChecks(LockingScript.fromHex('01ac75'))).toBe(0); // a pushed 0xac byte is data
});
