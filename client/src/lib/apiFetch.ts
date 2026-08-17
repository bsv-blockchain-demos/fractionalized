// The single choke-point for calling our own API: prefixes the API base, sends the
// session cookie, and on 401 (expired session) hard-navigates to /login. That 401
// branch is the only client-side handler for session expiry — don't remove it.

// Static member access, not destructured: Next only inlines NEXT_PUBLIC_* when it can
// see the literal property read. Empty = same-origin (the Next routes).
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "").replace(/\/+$/, "");

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Only our own root-relative paths; absolute URLs and Request objects pass through.
  const target = typeof input === "string" && input.startsWith("/") ? `${API_BASE}${input}` : input;
  const res = await fetch(target, { credentials: "include", ...init });
  if (res.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
  return res;
}
