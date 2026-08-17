import toast from "react-hot-toast";
import { apiFetch } from "./apiFetch";
import { navigateToLogin } from "./navigateToLogin";
import { logger } from "@shared/logger";

/**
 * Call before spending: catches an already-dead session before broadcast rather than after.
 * Racy by nature — pendingKeyMaterial is the actual backstop. check-session always returns
 * 200, so this never trips apiFetch's 401 redirect.
 */
export async function ensureSessionAlive(): Promise<boolean> {
  let authenticated: boolean;
  try {
    const res = await apiFetch("/api/check-session");
    const data = await res.json();
    authenticated = data?.authenticated === true;
  } catch (e) {
    // Fail closed: if check-session is unreachable the POST would fail too, so spending
    // first only orphans an output. Distinct message — retryable, not expired.
    logger.warn("ensureSessionAlive: check-session failed, refusing to spend", e);
    toast.error("Couldn't verify your session. Check your connection and try again.", {
      duration: 5000, position: "top-center", id: "session-unverified",
    });
    return false;
  }

  if (authenticated) return true;

  toast.error("Your session has expired. Please log in again.", {
    duration: 5000, position: "top-center", id: "session-expired",
  });
  navigateToLogin();
  return false;
}
