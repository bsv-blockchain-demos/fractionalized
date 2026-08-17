/**
 * Replaces src/middleware.ts. All three branches are asserted, because a guard that
 * redirects while `restoring` bounces an authenticated user to /login on every refresh.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { ProtectedRoute } from '../ProtectedRoute';

const useAuthContext = vi.fn();
vi.mock('@/context/walletContext', () => ({ useAuthContext: () => useAuthContext() }));

/** Renders the blocked path so `state.from` is observable, not just the redirect. */
function LoginProbe() {
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
  return <div>login from:{from ?? 'none'}</div>;
}

function renderAt(status: string) {
  useAuthContext.mockReturnValue({ status });
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/login" element={<LoginProbe />} />
        <Route path="/dashboard" element={<ProtectedRoute><div>secret</div></ProtectedRoute>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProtectedRoute', () => {
  it('renders children when authenticated, without redirecting', () => {
    renderAt('authenticated');
    expect(screen.getByText('secret')).toBeInTheDocument();
    expect(screen.queryByText(/^login from:/)).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows a loading status while restoring, without leaking the protected UI or redirecting', () => {
    renderAt('restoring');
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
    expect(screen.queryByText(/^login from:/)).not.toBeInTheDocument();
  });

  it('redirects to /login when idle, carrying the blocked path in state.from', () => {
    renderAt('idle');
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
    expect(screen.getByText('login from:/dashboard')).toBeInTheDocument();
  });
});
