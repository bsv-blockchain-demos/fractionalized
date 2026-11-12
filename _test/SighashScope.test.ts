import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { PrivateKey, ProtoWallet, PublicKey, Transaction, Script, MerklePath, LockingScript } from '@bsv/sdk';
import { PaymentUtxo } from '@shared/bsv/paymentUtxo';
import { hashFromPubkeys } from '@shared/bsv/hashFromPubkeys';

/**
 * M-3: our templates sign after createAction returns the complete tx, so they must use
 * SIGHASH_ALL. SINGLE|ANYONECANPAY dates from when scripts were pre-signed before the wallet
 * added inputs/outputs (replaced by createAction -> signAction in 29e1c63); left in place it
 * leaves outputs no signature commits to whenever the wallet adds no funding input.
 */

async function signAndTamper(signOutputs: 'all' | 'single', anyoneCanPay: boolean): Promise<boolean> {
  const wallet = new ProtoWallet(PrivateKey.fromRandom());
  const { publicKey } = await wallet.getPublicKey({ protocolID: [0, 'fractionalized'], keyID: '1', counterparty: 'self', forSelf: true });
  const other = PrivateKey.fromRandom().toPublicKey();
  const lock = new PaymentUtxo().lock(hashFromPubkeys([PublicKey.fromString(publicKey), other]));

  const src = new Transaction();
  src.addInput({ sourceTXID: '00'.repeat(32), sourceOutputIndex: 0, unlockingScript: Script.fromASM('OP_TRUE') });
  src.addOutput({ lockingScript: lock, satoshis: 1000 });
  src.merklePath = MerklePath.fromCoinbaseTxidAndHeight(src.id('hex'), 1);

  const tx = new Transaction();
  tx.addInput({
    sourceTransaction: src, sourceOutputIndex: 0,
    unlockingScriptTemplate: new PaymentUtxo().unlock(wallet as never, '1', 'self', other.toString(), signOutputs, anyoneCanPay),
  });
  tx.addOutput({ lockingScript: LockingScript.fromASM('OP_TRUE'), satoshis: 1 });
  tx.addOutput({ lockingScript: lock, satoshis: 900 }); // e.g. the payment-pool change
  await tx.sign();
  expect(await tx.verify('scripts only')).toBe(true);

  // Redirect the change output to an attacker; the signed input is untouched.
  tx.outputs[1].lockingScript = LockingScript.fromASM('OP_FALSE OP_RETURN');
  return tx.verify('scripts only').catch(() => false);
}

describe('M-3: signature scope', () => {
  test('SINGLE|ANYONECANPAY leaves a later output uncommitted', async () => {
    expect(await signAndTamper('single', true)).toBe(true);
  });

  test('ALL commits every output', async () => {
    expect(await signAndTamper('all', false)).toBe(false);
  });
});

const ROOT = join(__dirname, '..');
const SCAN = [join(ROOT, 'client', 'src'), join(ROOT, 'server')];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === '__tests__') return [];
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(full) ? [full] : [];
  });
}

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));

test('M-3: no unlock call site signs with SIGHASH_SINGLE', () => {
  const files = SCAN.flatMap(walk);
  expect(files.length).toBeGreaterThan(40); // guards against a vacuous scan

  const offenders = files.flatMap((f) =>
    stripComments(readFileSync(f, 'utf-8')).split('\n')
      .map((line, i) => (/["']single["']/.test(line) ? `${relative(ROOT, f)}:${i + 1}` : null))
      .filter((x): x is string => x !== null));
  expect(offenders).toEqual([]);
});
