/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Look for any *.test.ts(x) or *.spec.ts(x) under _test/
  testMatch: ['**/_test/**/*.(test|spec).[tj]s?(x)'],
  // Use regex fragments (Jest expects regex), not absolute paths, to avoid Windows escaping issues
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/.next/'],
}
