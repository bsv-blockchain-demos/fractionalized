import { describe, test, expect, beforeEach, vi } from 'vitest';

// The boot test below imports main.tsx. jsdom can't parse Tailwind v4's output and
// dumps the whole stylesheet to stderr, so stub it out.
vi.mock('../../globals.css', () => ({}));

/** Re-import so the module-level `import.meta.env` read sees the current stub. */
async function loadEnv() {
  vi.resetModules();
  return import('@/lib/env');
}

describe('lib/env', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  test('SERVER_IDENTITY_KEY is read from env at import time', async () => {
    vi.stubEnv('VITE_SERVER_IDENTITY_KEY', '02abc123');
    const env = await loadEnv();
    expect(env.SERVER_IDENTITY_KEY).toBe('02abc123');
    expect(() => env.assertEnv()).not.toThrow();
  });

  test('assertEnv throws when VITE_SERVER_IDENTITY_KEY is missing', async () => {
    vi.stubEnv('VITE_SERVER_IDENTITY_KEY', '');
    const env = await loadEnv();
    expect(() => env.assertEnv()).toThrow(/VITE_SERVER_IDENTITY_KEY/);
  });

  test('assertEnv throws on a whitespace-only key', async () => {
    vi.stubEnv('VITE_SERVER_IDENTITY_KEY', '   ');
    const env = await loadEnv();
    expect(() => env.assertEnv()).toThrow(/VITE_SERVER_IDENTITY_KEY/);
  });

  // assertEnv was dead code before this task; nothing else catches its call being dropped.
  test('boot fails fast rather than deriving keys against a missing counterparty', async () => {
    vi.stubEnv('VITE_SERVER_IDENTITY_KEY', '');
    document.body.innerHTML = '<div id="root"></div>';
    vi.resetModules();
    await expect(import('@/main')).rejects.toThrow(/VITE_SERVER_IDENTITY_KEY/);
  });
});
