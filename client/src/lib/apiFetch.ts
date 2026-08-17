// The single choke-point for calling our own API: prefixes the API base and sends
// the session cookie. Empty base = same-origin.
import { navigateToLogin } from "./navigateToLogin";

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");

/** Only our own root-relative paths get the base; absolute URLs and Requests pass through. */
function withBase(input: RequestInfo | URL): RequestInfo | URL {
  return typeof input === "string" && input.startsWith("/") ? `${API_BASE}${input}` : input;
}

/**
 * No 401 handling. For step-up calls that may already have broadcast an output:
 * a hard navigate would destroy the in-memory recovery data (finding C-5).
 */
export function apiFetchNoRedirect(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(withBase(input), { credentials: "include", ...init });
}

/**
 * On 401 (expired session) hard-navigates to /login. That branch is the only
 * client-side handler for session expiry — don't remove it.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await apiFetchNoRedirect(input, init);
  if (res.status === 401 && window.location.pathname !== "/login") {
    navigateToLogin();
  }
  return res;
}
