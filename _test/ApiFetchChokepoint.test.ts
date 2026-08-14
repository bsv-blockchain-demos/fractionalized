import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * A raw `fetch("/api/...")` in client code bypasses apiFetch's base prefix, credentials
 * and 401 handling — it compiles, tests pass, and it silently hits the wrong server.
 * Found three real offenders when written (login.tsx, navbar.tsx, marketplace.tsx).
 */

const SRC = join(__dirname, '..', 'src');

/** The choke-point itself — the one file allowed to call the real `fetch`. */
const ALLOWED = [join('src', 'utils', 'apiFetch.ts')];

/** Server-side route handlers are not client code. */
const SKIP_DIRS = [join('src', 'app', 'api')];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(full) ? [full] : [];
  });
}

/** Blank out line and block comments so commented-out code can't trip the scan. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

/** Bare `fetch(` only. The lookbehind is essential: without it `apiFetch(` matches too. */
const RAW_FETCH = /(?<![A-Za-z0-9_$.])fetch\s*\(/g;

describe('apiFetch is the only path to our API', () => {
  const files = walk(SRC).filter((f) => {
    const rel = relative(join(__dirname, '..'), f);
    if (ALLOWED.includes(rel)) return false;
    return !SKIP_DIRS.some((d) => rel.startsWith(d + sep));
  });

  test('scans a non-trivial number of client files', () => {
    // Stops a path/filter mistake making this test vacuously pass.
    expect(files.length).toBeGreaterThan(20);
  });

  test('no client file calls raw fetch() against an /api/ path', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const src = stripComments(readFileSync(file, 'utf-8'));
      for (const match of src.matchAll(RAW_FETCH)) {
        const start = match.index ?? 0;
        // Scope to the call's own argument so an unrelated fetch() isn't blamed.
        const arg = src.slice(start, start + 80);
        if (arg.includes('/api')) {
          const line = src.slice(0, start).split('\n').length;
          offenders.push(`${relative(join(__dirname, '..'), file)}:${line}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
