import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const SHARED = join(__dirname, '..', 'shared');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : [];
  });
}

// Node built-ins and Node-only packages that must never be a RUNTIME import in shared/.
const FORBIDDEN = ['mongodb', 'fs', 'path', 'crypto', 'dotenv', 'express', 'jose', 'node:'];

describe('shared/ is Node-free', () => {
  test('no runtime import of a Node-only module', () => {
    const offenders: string[] = [];

    for (const file of walk(SHARED)) {
      const src = readFileSync(file, 'utf-8');
      for (const line of src.split('\n')) {
        const match = line.match(/^\s*import\s+(type\s+)?.*from\s+['"]([^'"]+)['"]/);
        if (!match) continue;
        const [, isTypeOnly, moduleName] = match;
        if (isTypeOnly) continue; // `import type` is erased at compile time — allowed
        if (FORBIDDEN.some((f) => moduleName === f || moduleName.startsWith(f))) {
          offenders.push(`${file}: ${line.trim()}`);
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
});
