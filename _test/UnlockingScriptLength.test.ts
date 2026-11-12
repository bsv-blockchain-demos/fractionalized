import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { LockingScript, MerklePath, PrivateKey, ProtoWallet, Script, Transaction } from '@bsv/sdk';
import { OrdinalsP2MS } from '@shared/bsv/ordinalsP2MS';
import { OrdinalsP2PKH } from '@shared/bsv/ordinalsP2PKH';
import { PaymentUtxo } from '@shared/bsv/paymentUtxo';

/**
 * createAction's unlockingScriptLength is a promise the final script must not exceed, and
 * ECDSA signatures vary in length (DER 70-71 bytes + sighash byte). Measuring one preimage
 * signature and declaring that length fails whenever the real signature comes out a byte
 * longer — found by the live testnet run ("unlockingScript length ... exceeds expected").
 * Declare the template's estimateLength(), which is the upper bound.
 */

const SIGNINGS = 200;

async function maxSignedLength(
  template: { sign: (tx: Transaction, i: number) => Promise<{ toBinary(): number[] }>; estimateLength: () => Promise<number> },
): Promise<{ max: number; estimate: number }> {
  const src = new Transaction();
  src.addInput({ sourceTXID: '00'.repeat(32), sourceOutputIndex: 0, unlockingScript: Script.fromASM('OP_TRUE') });
  src.addOutput({ lockingScript: LockingScript.fromASM('OP_TRUE'), satoshis: 1000 });
  src.merklePath = MerklePath.fromCoinbaseTxidAndHeight(src.id('hex'), 1);
  let max = 0;
  for (let n = 0; n < SIGNINGS; n++) {
    const tx = new Transaction();
    tx.addInput({ sourceTransaction: src, sourceOutputIndex: 0 });
    tx.addOutput({ lockingScript: LockingScript.fromASM('OP_TRUE'), satoshis: 900 + n }); // new preimage each time
    max = Math.max(max, (await template.sign(tx, 0)).toBinary().length);
  }
  return { max, estimate: await template.estimateLength() };
}

describe('template estimateLength() bounds every real signature', () => {
  const wallet = new ProtoWallet(PrivateKey.fromRandom());
  const other = PrivateKey.fromRandom().toPublicKey().toString();

  test('OrdinalsP2MS', async () => {
    const { max, estimate } = await maxSignedLength(new OrdinalsP2MS().unlock(wallet as never, '1', 'self', other));
    expect(max).toBeLessThanOrEqual(estimate);
  });
  test('PaymentUtxo', async () => {
    const { max, estimate } = await maxSignedLength(new PaymentUtxo().unlock(wallet as never, '1', 'self', other));
    expect(max).toBeLessThanOrEqual(estimate);
  });
  test('OrdinalsP2PKH', async () => {
    const { max, estimate } = await maxSignedLength(new OrdinalsP2PKH().unlock(wallet as never));
    expect(max).toBeLessThanOrEqual(estimate);
  });
});

const ROOT = join(__dirname, '..');
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === '__tests__') return [];
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(full) ? [full] : [];
  });
}

test('no call site declares an unlocking-script length measured from one signature', () => {
  const files = [join(ROOT, 'client', 'src'), join(ROOT, 'server')].flatMap(walk);
  expect(files.length).toBeGreaterThan(40);
  const offenders = files.flatMap((f) =>
    readFileSync(f, 'utf-8').split('\n')
      .map((line, i) => (/[Uu]nlockingScript[A-Za-z]*\.toHex\(\)\.length\s*\/\s*2/.test(line) ? `${relative(ROOT, f)}:${i + 1}` : null))
      .filter((x): x is string => x !== null));
  expect(offenders).toEqual([]);
});
