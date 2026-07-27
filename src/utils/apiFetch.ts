// Client fetch wrapper: on 401 (expired/invalid session) send the user to /login via a
// hard navigation, so middleware clears any stale cookie and renders login. Otherwise
// behaves exactly like fetch (returns the Response).
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
  return res;
}
