describe("logger", () => {
  const origEnv = process.env.NODE_ENV;
  // NODE_ENV is typed read-only (Next narrows it), so cast to assign it in tests.
  const setNodeEnv = (v: string | undefined) => {
    (process.env as Record<string, string | undefined>).NODE_ENV = v;
  };
  afterEach(() => { setNodeEnv(origEnv); jest.restoreAllMocks(); });

  test("debug is silent in production", () => {
    setNodeEnv("production");
    jest.resetModules();
    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    const { logger } = require("../shared/logger");
    logger.debug("secret");
    expect(spy).not.toHaveBeenCalled();
  });

  test("debug emits outside production", () => {
    setNodeEnv("development");
    jest.resetModules();
    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    const { logger } = require("../shared/logger");
    logger.debug("hi");
    expect(spy).toHaveBeenCalled();
  });

  test("error always emits", () => {
    setNodeEnv("production");
    jest.resetModules();
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { logger } = require("../shared/logger");
    logger.error("boom");
    expect(spy).toHaveBeenCalled();
  });
});

describe('logger without a process global (browser)', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  test('debug and info do not throw when `process` is undefined', async () => {
    const originalProcess = globalThis.process;
    try {
      // Simulate a browser: Vite does not shim process.env the way Next does.
      // @ts-expect-error deliberately removing a Node global
      delete globalThis.process;

      jest.resetModules();
      const { logger } = await import('@shared/logger');

      expect(() => logger.debug('hello')).not.toThrow();
      expect(() => logger.info('hello')).not.toThrow();
      expect(() => logger.warn('hello')).not.toThrow();
      expect(() => logger.error('hello')).not.toThrow();
    } finally {
      globalThis.process = originalProcess; // MUST restore or the rest of the suite breaks
    }
  });

  test('debug and info still emit when `process` is undefined (absent process lands on the visible side)', async () => {
    const originalProcess = globalThis.process;
    try {
      // @ts-expect-error deliberately removing a Node global
      delete globalThis.process;

      jest.resetModules();
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
      const { logger } = await import('@shared/logger');

      logger.debug('hello');
      logger.info('hello');

      // A guard that treats a missing `process` as "production" would suppress
      // these silently in the browser bundle. Absence-of-throw alone can't catch
      // that inversion, so assert emission directly.
      expect(logSpy).toHaveBeenCalled();
      expect(infoSpy).toHaveBeenCalled();
    } finally {
      globalThis.process = originalProcess; // MUST restore or the rest of the suite breaks
    }
  });
});
