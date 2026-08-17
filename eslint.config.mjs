import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

// Flat config, Next-free. Mirrors the rule surface the old
// next/core-web-vitals + next/typescript pair provided
export default [
  {
    // .superpowers holds archived snapshots of deleted source; not the codebase.
    ignores: ['node_modules/**', 'out/**', 'build/**', 'client/dist/**', '.superpowers/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // Found M-11 (a real hook-dependency defect) in this codebase — keep it on.
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      'prefer-const': 'off',
    },
  },
];
