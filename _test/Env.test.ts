describe("utils/env", () => {
  const ENV_KEY = "NEXT_PUBLIC_SERVER_PUBLIC_KEY";

  const setEnv = (val?: string) => {
    if (val === undefined) delete (process.env as any)[ENV_KEY];
    else (process.env as any)[ENV_KEY] = val;
  };

  beforeEach(() => {
    jest.resetModules();
  });

  test("SERVER_PUBLIC_KEY is read from env at import time", async () => {
    const pub = "02abc123";
    setEnv(pub);
    const env = await import("../src/utils/env");
    expect(env.SERVER_PUBLIC_KEY).toBe(pub);
    expect(() => env.assertEnv()).not.toThrow();
  });

  test("assertEnv throws when NEXT_PUBLIC_SERVER_PUBLIC_KEY is missing", async () => {
    setEnv(undefined);
    const env = await import("../src/utils/env");
    expect(() => env.assertEnv()).toThrow(/NEXT_PUBLIC_SERVER_PUBLIC_KEY/);
  });
});
