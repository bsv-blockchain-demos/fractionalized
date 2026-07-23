// Leveled logger. debug/info are silent in production; warn/error always emit.
// `isProd` is read per-call so tests can flip NODE_ENV via jest.resetModules().
export const logger = {
  debug: (...args: unknown[]) => { if (process.env.NODE_ENV !== "production") console.log(...args); },
  info: (...args: unknown[]) => { if (process.env.NODE_ENV !== "production") console.info(...args); },
  warn: (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
};
