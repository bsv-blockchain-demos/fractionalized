import { QueryClient } from '@tanstack/react-query';

/**
 * Step-up reads cost a wallet signature and a server-side nonce, so they get a much longer
 * window than a plain read. Applied per-query, not as a default.
 */
export const STEP_UP_STALE_TIME = 5 * 60_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Every focus would otherwise re-run each query — for a step-up read that is a fresh
      // wallet signature and a consumed nonce per focus.
      refetchOnWindowFocus: false,
      // A retried step-up read mints a NEW proof: hard failures look transient and each
      // attempt burns another nonce.
      retry: 0,
      staleTime: 30_000,
    },
  },
});
