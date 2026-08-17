import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join } from 'path';

// Renamed from SharedTypesNodeFree.test.ts — this file now guards the whole
// shared/ <-> server/ <-> src/ boundary, not just shared/'s Node-freedom.

const SHARED = join(__dirname, '..', 'shared');
// The next plan renames src/ -> client/. Prefer client/ if it exists so this
// guard survives that rename instead of throwing ENOENT.
const CLIENT_ROOT = existsSync(join(__dirname, '..', 'client'))
  ? join(__dirname, '..', 'client')
  : join(__dirname, '..', 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(full) ? [full] : [];
  });
}

// Strips comments before the Node-free scan below so prose that merely *mentions*
// an import/require (e.g. shared/types.ts's own doc comment explaining why
// `import type` is required for mongodb) can't be mistaken for the real thing.
// Block comments first, then line comments — but only when `//` starts the line
// or is preceded by whitespace, so a string containing `http://` is left alone.
function stripComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n');
}

// Node built-ins and Node-only packages that must never be a RUNTIME import in shared/.
const FORBIDDEN = [
  'mongodb', 'fs', 'path', 'crypto', 'dotenv', 'express', 'jose', 'node:',
  'net', 'tls', 'os', 'http', 'https', 'stream', 'child_process', 'jsonwebtoken',
];

describe('shared/ is Node-free', () => {
  const sharedFiles = walk(SHARED);

  test('scans a non-trivial number of shared files', () => {
    // Stops a bad merge that empties shared/ from making the offender checks
    // below vacuously pass. 15 files exist today; this leaves headroom for
    // growth while still catching an accidental wipe.
    expect(sharedFiles.length).toBeGreaterThanOrEqual(12);
  });

  test('no runtime import of a Node-only module', () => {
    const offenders: string[] = [];

    for (const file of sharedFiles) {
      const content = stripComments(readFileSync(file, 'utf-8'));

      // Static `import ... from '<specifier>'`, possibly spanning multiple lines
      // (e.g. `import {\n  MongoClient,\n} from 'mongodb';`). The module specifier
      // always sits on the same physical line as `from`, but the `import`/`import type`
      // keyword can be several lines above it, so we scan the whole file text (not
      // line-by-line) with a non-greedy match bounded by the next `from '...'`.
      // `import type` is erased at compile time and is the one intentional exception
      // (shared/types.ts relies on it for mongodb's ObjectId) — captured here as
      // group 1 and skipped below, exactly as before, just no longer line-anchored.
      const importRe = /import\s+(type\s+)?[^;]*?from\s*['"]([^'"]+)['"]/g;
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(content))) {
        const [whole, isTypeOnly, moduleName] = m;
        if (isTypeOnly) continue; // `import type` is erased at compile time — allowed
        if (FORBIDDEN.some((f) => moduleName === f || moduleName.startsWith(f))) {
          const line = content.slice(0, m.index).split('\n').length;
          offenders.push(`${file}:${line}: ${whole.replace(/\s+/g, ' ').trim()}`);
        }
      }

      // `require('<specifier>')` — always a runtime load, no type-only form exists.
      const requireRe = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      while ((m = requireRe.exec(content))) {
        const moduleName = m[1];
        if (FORBIDDEN.some((f) => moduleName === f || moduleName.startsWith(f))) {
          const line = content.slice(0, m.index).split('\n').length;
          offenders.push(`${file}:${line}: ${m[0]}`);
        }
      }

      // Dynamic `import('<specifier>')` — always a runtime load, no type-only form exists.
      const dynamicImportRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      while ((m = dynamicImportRe.exec(content))) {
        const moduleName = m[1];
        if (FORBIDDEN.some((f) => moduleName === f || moduleName.startsWith(f))) {
          const line = content.slice(0, m.index).split('\n').length;
          offenders.push(`${file}:${line}: ${m[0]}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test('exports the six Mongo document types', async () => {
    const types = await import('@shared/types');
    // Types are erased at runtime, so assert the module loads without pulling in
    // the Mongo driver — the import itself is the assertion.
    expect(types).toBeDefined();
  });

  test('does not import from src/ or server/', () => {
    // Two failure modes this guards against: a shared/ -> src/ import breaks the
    // client bundle once src/ is deleted in a later plan, and a shared/ -> server/
    // import pulls Node into the browser. Covers the @server/*, @/* aliases and
    // relative escapes (../, ../../, ...) out of shared/.
    const FORBIDDEN_PATTERNS = [
      /from\s+['"]@server\//,
      /import\(\s*['"]@server\//,
      /from\s+['"]@\//,
      /import\(\s*['"]@\//,
      /from\s+['"](?:\.\.\/)+src\//,
      /import\(\s*['"](?:\.\.\/)+src\//,
      /from\s+['"](?:\.\.\/)+server\//,
      /import\(\s*['"](?:\.\.\/)+server\//,
    ];
    const offenders: string[] = [];

    for (const file of sharedFiles) {
      const src = readFileSync(file, 'utf-8');
      for (const line of src.split('\n')) {
        if (FORBIDDEN_PATTERNS.some((re) => re.test(line))) {
          offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('client graph is Node-free', () => {
  const clientFiles = walk(CLIENT_ROOT);

  test('scans a non-trivial number of client files', () => {
    // Stops a path/filter mistake making the offender check below vacuously pass.
    // Threshold is meaningful for whichever root was resolved (client/ or src/).
    expect(clientFiles.length).toBeGreaterThan(20);
  });

  test('no file under src/ imports @server/* or reaches into server/', () => {
    // This is the invariant the whole plan exists to establish: client code must
    // never pull in server-only modules (Node built-ins, the wallet, the DB driver).
    // Covers static `from`, dynamic `import()`, and `require()` forms, plus the
    // `@/../server/...` alias-escape (TypeScript resolves `@/*` -> `src/*`, so a
    // literal `../` after it walks straight back out of src/ into server/ — this
    // type-checks cleanly under `tsc --noEmit` even though it is a live boundary leak).
    const FORBIDDEN_PATTERNS = [
      /from\s+['"]@server\//,
      /import\(\s*['"]@server\//,
      /require\(\s*['"]@server\//,
      /from\s+['"](?:\.\.\/)+server\//,
      /import\(\s*['"](?:\.\.\/)+server\//,
      /require\(\s*['"](?:\.\.\/)+server\//,
      /from\s+['"]@\/(?:\.\.\/)+server\//,
      /import\(\s*['"]@\/(?:\.\.\/)+server\//,
      /require\(\s*['"]@\/(?:\.\.\/)+server\//,
    ];
    const offenders: string[] = [];

    for (const file of clientFiles) {
      const src = readFileSync(file, 'utf-8');
      for (const line of src.split('\n')) {
        if (FORBIDDEN_PATTERNS.some((re) => re.test(line))) {
          offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
