// Leveled logger. debug/info are silent in production; warn/error always emit.
// Dual-use: `process` is read through a guard because Vite (unlike Next) does not
// shim process.env in the browser bundle. Read per-call, not hoisted, so tests
// can flip NODE_ENV via jest.resetModules().
function isProduction(): boolean {
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
}

export const logger = {
  debug: (...args: unknown[]) => { if (!isProduction()) console.log(...args); },
  info: (...args: unknown[]) => { if (!isProduction()) console.info(...args); },
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
};
