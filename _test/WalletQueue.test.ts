import type { WalletInterface } from '@bsv/sdk';
import { WalletQueue } from '@server/lib/walletQueue';

// The queue never inspects the wallet; it only passes it through.
const fakeWallet = {} as WalletInterface;

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('WalletQueue', () => {
  test('runs actions one at a time in FIFO order', async () => {
    const q = new WalletQueue(fakeWallet);
    const events: string[] = [];

    const job = (name: string, ms: number) => q.enqueue(name, async () => {
      events.push(`${name}:start`);
      await new Promise((r) => setTimeout(r, ms));
      events.push(`${name}:end`);
      return name;
    });

    // 'a' is slower than 'b'; if they overlapped, a:end would come after b:start.
    const results = await Promise.all([job('a', 30), job('b', 1)]);

    expect(results).toEqual(['a', 'b']);
    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  test('passes the wallet to the action', async () => {
    const q = new WalletQueue(fakeWallet);
    const seen = await q.enqueue('w', async (w) => w);
    expect(seen).toBe(fakeWallet);
  });

  test('a rejected action rejects only its own caller', async () => {
    const q = new WalletQueue(fakeWallet);
    const bad = q.enqueue('bad', async () => { throw new Error('boom'); });
    const good = q.enqueue('good', async () => 'ok');

    await expect(bad).rejects.toThrow('boom');
    await expect(good).resolves.toBe('ok');
  });

  test('a rejected action does not stall the queue', async () => {
    const q = new WalletQueue(fakeWallet);
    void q.enqueue('bad', async () => { throw new Error('boom'); }).catch(() => {});
    await expect(q.enqueue('after', async () => 'ran')).resolves.toBe('ran');
  });

  test('depth() counts queued + running and returns to 0', async () => {
    const q = new WalletQueue(fakeWallet);
    expect(q.depth()).toBe(0);

    const a = q.enqueue('a', async () => { await tick(); return 1; });
    const b = q.enqueue('b', async () => 2);
    expect(q.depth()).toBe(2);

    await Promise.all([a, b]);
    expect(q.depth()).toBe(0);
  });

  test('depth() returns to 0 even when an action rejects', async () => {
    const q = new WalletQueue(fakeWallet);
    await q.enqueue('bad', async () => { throw new Error('boom'); }).catch(() => {});
    expect(q.depth()).toBe(0);
  });
});
