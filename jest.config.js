/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Look for any *.test.ts(x) or *.spec.ts(x) under _test/
  testMatch: ['**/_test/**/*.(test|spec).[tj]s?(x)'],
  // Use regex fragments (Jest expects regex), not absolute paths, to avoid Windows escaping issues
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/.next/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@server/(.*)$': '<rootDir>/server/$1',
  },
  // `jose` ships ESM-only (no CJS build). Jest's default node_modules transform-skip
  // would otherwise choke on its `export`/`import` syntax, so allowlist just that
  // package for transformation and let ts-jest transpile its plain JS to CJS.
  transformIgnorePatterns: ['/node_modules/(?!jose/)'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {}],
    'node_modules[\\\\/]jose[\\\\/].+\\.js$': ['ts-jest', { tsconfig: { allowJs: true, module: 'commonjs', target: 'es2020' } }],
  },
  // Several tests are live-network integration tests against store-us-1.bsvb.tech
  testTimeout: 30000,
}
