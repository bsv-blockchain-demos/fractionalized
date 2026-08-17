/** Isolated so tests can mock navigation without fighting jsdom's non-configurable Location. */
export function navigateToLogin(): void {
  if (typeof window !== "undefined") window.location.href = "/login";
}
