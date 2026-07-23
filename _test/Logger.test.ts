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
    const { logger } = require("../src/utils/logger");
    logger.debug("secret");
    expect(spy).not.toHaveBeenCalled();
  });

  test("debug emits outside production", () => {
    setNodeEnv("development");
    jest.resetModules();
    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    const { logger } = require("../src/utils/logger");
    logger.debug("hi");
    expect(spy).toHaveBeenCalled();
  });

  test("error always emits", () => {
    setNodeEnv("production");
    jest.resetModules();
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { logger } = require("../src/utils/logger");
    logger.error("boom");
    expect(spy).toHaveBeenCalled();
  });
});
