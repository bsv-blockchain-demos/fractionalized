import { describe, it, expect } from 'vitest';
import { toOutpoint } from '@shared/bsv/outpoints';

describe('client toolchain', () => {
  it('resolves the @shared alias', () => {
    expect(typeof toOutpoint).toBe('function');
  });

  it('exposes import.meta.env', () => {
    expect(import.meta.env).toBeDefined();
  });
});
