// Runs once at server startup — fail fast if required env is missing/invalid.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertServerConfig } = await import("./lib/config");
    assertServerConfig();
  }
}
