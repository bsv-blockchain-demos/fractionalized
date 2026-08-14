import fs from 'fs';
import path from 'path';

/**
 * Static guard for the wallet-queue enqueue boundary.
 *
 * The three queue-using routes (tokenize, share-purchase, listing-purchase)
 * each depend on a single invariant: createAction + signAction (+ any
 * internalize call) run inside exactly ONE `queue.enqueue(...)` callback, and
 * broadcastTX / a second enqueue / getWalletQueue() never run inside that
 * callback. A route test that mocks the wallet and queue can't catch a
 * regression here — it would just re-assert a verbatim copy of the route
 * against itself. This test instead parses the route source directly and
 * checks the boundary mechanically.
 *
 * Every one of these files also contains doc comments that mention
 * `queue.enqueue()` and `getWalletQueue()` in prose (see the header comments
 * in each route). Comments and string/template literals are stripped before
 * any regex scan runs, or those doc comments would produce false positives —
 * a naive `grep -c enqueue` on tokenize.ts finds 2 occurrences where there is
 * only 1 real call site.
 */

const ROUTE_FILES = [
  'server/routes/tokenize.ts',
  'server/routes/sharePurchase.ts',
  'server/routes/listingPurchase.ts',
  // add a new queue-using route's path here — nothing else in this file changes.
];

const REPO_ROOT = path.resolve(__dirname, '..');

/**
 * Blank out line comments, block comments, and string/template literals,
 * preserving all other characters (including code braces) at their original
 * offsets. This is NOT a full JS/TS parser — it does not handle every edge
 * case (e.g. a `/` inside a regex literal) — but it is sufficient for these
 * specific, hand-written route files, per the task brief's explicit guidance
 * to avoid adding a parser dependency.
 */
function stripCommentsAndStrings(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    // Line comment: skip to (but not past) the newline, so line structure survives.
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }

    // Block comment.
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    // String / template literal — blank the whole thing, respecting backslash escapes.
    if (c === '\'' || c === '"' || c === '`') {
      const quote = c;
      out += ' ';
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') { i += 2; continue; }
        i++;
      }
      i++; // skip closing quote
      continue;
    }

    out += c;
    i++;
  }
  return out;
}

/** All match indices (in the stripped source) for a global regex. */
function indicesOf(stripped: string, re: RegExp): number[] {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = g.exec(stripped))) out.push(m.index);
  return out;
}

/** Byte span [start, end] (both inclusive) of the enqueue callback's `{ ... }` body. */
function enqueueCallbackSpan(stripped: string, enqueueCallIndex: number): { start: number; end: number } {
  const braceStart = stripped.indexOf('{', enqueueCallIndex);
  if (braceStart === -1) throw new Error('No callback body found after .enqueue( call');
  let depth = 0;
  let i = braceStart;
  for (; i < stripped.length; i++) {
    if (stripped[i] === '{') depth++;
    else if (stripped[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) throw new Error('Unbalanced braces while scanning for callback end');
  return { start: braceStart, end: i };
}

const withinSpan = (span: { start: number; end: number }, idx: number) => idx >= span.start && idx <= span.end;

describe.each(ROUTE_FILES)('enqueue boundary: %s', (relPath) => {
  const absPath = path.join(REPO_ROOT, relPath);
  const raw = fs.readFileSync(absPath, 'utf8');
  const stripped = stripCommentsAndStrings(raw);

  test('exactly one .enqueue( call site', () => {
    const calls = indicesOf(stripped, /\.enqueue\(/g);
    expect(calls.length).toBe(1);
  });

  test('createAction / signAction / internalizeToBasket / internalizeAction all lie inside the enqueue callback', () => {
    const [enqueueCallIndex] = indicesOf(stripped, /\.enqueue\(/g);
    const span = enqueueCallbackSpan(stripped, enqueueCallIndex);

    const walletCallPatterns = [/\bcreateAction\(/g, /\bsignAction\(/g, /\binternalizeToBasket\(/g, /\binternalizeAction\(/g];
    for (const pattern of walletCallPatterns) {
      const idxs = indicesOf(stripped, pattern);
      for (const idx of idxs) {
        expect(withinSpan(span, idx)).toBe(true);
      }
    }
  });

  test('broadcastTX( does not lie inside the enqueue callback', () => {
    const [enqueueCallIndex] = indicesOf(stripped, /\.enqueue\(/g);
    const span = enqueueCallbackSpan(stripped, enqueueCallIndex);

    const idxs = indicesOf(stripped, /\bbroadcastTX\(/g);
    for (const idx of idxs) {
      expect(withinSpan(span, idx)).toBe(false);
    }
  });

  test('no enqueue( or getWalletQueue( call lies inside the enqueue callback (re-entrancy deadlock)', () => {
    const [enqueueCallIndex] = indicesOf(stripped, /\.enqueue\(/g);
    const span = enqueueCallbackSpan(stripped, enqueueCallIndex);

    // Broad on purpose: catches `.enqueue(`, a bare `enqueue(`, or any rename
    // that still ends in `enqueue(`.
    const enqueueOccurrences = indicesOf(stripped, /enqueue\(/g);
    for (const idx of enqueueOccurrences) {
      expect(withinSpan(span, idx)).toBe(false);
    }

    const getWalletQueueOccurrences = indicesOf(stripped, /getWalletQueue\(/g);
    for (const idx of getWalletQueueOccurrences) {
      expect(withinSpan(span, idx)).toBe(false);
    }
  });
});

/**
 * Coverage gap this closes: the four checks above only ever look INSIDE
 * ROUTE_FILES. If a future edit adds a wallet UTXO call to a route file that
 * is never added to ROUTE_FILES, every assertion above still passes — the
 * exact regression this migration exists to prevent, invisible to this test
 * file. This describe block scans every *other* file under server/routes/
 * (enumerated from the filesystem, so a brand-new route file is caught
 * automatically — nothing to remember to update here) and asserts none of
 * them contain a wallet-mutating call.
 *
 * Scanned tokens: createAction( and signAction( (the two calls that select/
 * spend UTXOs) and internalizeAction( (the underlying wallet call that
 * mutates basket state). Deliberately NOT internalizeToBasket( — that's the
 * queue-boundary wrapper (see server/lib/serverWallet.ts or the ROUTE_FILES'
 * own usage) which a non-queue file may legitimately reference (e.g.
 * importing its type) without itself touching the wallet; internalizeAction(
 * is what actually mutates wallet state and is what must stay confined to a
 * ROUTE_FILES enqueue span.
 */
describe('enqueue boundary: routes outside ROUTE_FILES stay wallet-free', () => {
  const routesDir = path.join(REPO_ROOT, 'server/routes');
  const nonQueueFiles = fs
    .readdirSync(routesDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => `server/routes/${f}`)
    .filter((f) => !ROUTE_FILES.includes(f));

  test.each(nonQueueFiles)(
    '%s contains no createAction(/signAction(/internalizeAction( call',
    (relPath) => {
      const raw = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
      const stripped = stripCommentsAndStrings(raw);

      const walletMutationPatterns = [/\bcreateAction\(/g, /\bsignAction\(/g, /\binternalizeAction\(/g];
      for (const pattern of walletMutationPatterns) {
        expect(indicesOf(stripped, pattern).length).toBe(0);
      }
    },
  );
});
