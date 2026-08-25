// Browsers have no node:crypto. @bsv/sdk's Hash.js probes for it with a guarded
// require(); Vite's dep optimizer rewrites that into its externalized-module shim, whose
// property getters log "has been externalized..." on every access — before the SDK's own
// try/catch falls back to pure JS. An empty module makes that probe fail silently.
// Randomness is unaffected: Random.js prefers globalThis.crypto.getRandomValues.
export {};
