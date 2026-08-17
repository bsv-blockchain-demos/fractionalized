/**
 * Login must return the user to the path ProtectedRoute bounced them from, not a
 * hardcoded landing page — the whole point of carrying `state.from`.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { AuthStatus } from '@/context/walletContext';

const mockMarkAuthenticated = vi.fn();
const ctx = { status: 'idle' as AuthStatus, markAuthenticated: mockMarkAuthenticated };
vi.mock('@/context/walletContext', () => ({
  useAuthContext: () => ({
    userWallet: {},
    ensureWallet: vi.fn().mockResolvedValue('02' + 'ab'.repeat(32)),
    ...ctx,
  }),
}));

vi.mock('@shared/authProof', () => ({
  authClient: { createAuthProof: vi.fn().mockResolvedValue({ sig: 'stub' }) },
}));

const mockApiFetch = vi.fn();
vi.mock('@/lib/apiFetch', () => ({ apiFetch: (...args: unknown[]) => mockApiFetch(...args) }));

vi.mock('react-hot-toast', () => ({
  __esModule: true,
  toast: { error: vi.fn(), success: vi.fn() },
  default: { error: vi.fn(), success: vi.fn() },
}));

import { Login } from '@/components/login';

function renderLoginAt(from?: string) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/login', state: from ? { from: { pathname: from } } : null }]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<div>dashboard page</div>} />
        <Route path="/marketplace" element={<div>marketplace page</div>} />
        <Route path="/" element={<div>home page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const clickLogin = async () => {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /login with wallet/i })); });
};

beforeEach(() => {
  vi.clearAllMocks();
  ctx.status = 'idle';
  mockApiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
});
afterEach(() => { cleanup(); });

describe('Login redirect', () => {
  test('returns to state.from after a successful login', async () => {
    renderLoginAt('/marketplace');
    await clickLogin();
    expect(mockMarkAuthenticated).toHaveBeenCalledTimes(1);
    expect(screen.getByText('marketplace page')).toBeInTheDocument();
    expect(screen.queryByText('dashboard page')).not.toBeInTheDocument();
  });

  test('falls back to /dashboard when nothing was blocked', async () => {
    renderLoginAt();
    await clickLogin();
    expect(screen.getByText('dashboard page')).toBeInTheDocument();
  });

  test('stays put on a failed login', async () => {
    mockApiFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: 'nope' }) });
    renderLoginAt('/marketplace');
    await clickLogin();
    expect(mockMarkAuthenticated).not.toHaveBeenCalled();
    expect(screen.queryByText('marketplace page')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /login with wallet/i })).toBeInTheDocument();
  });

  test('an already-authenticated visitor never sees the form (was middleware.ts:19-22)', () => {
    ctx.status = 'authenticated';
    renderLoginAt();
    expect(screen.queryByRole('button', { name: /login with wallet/i })).not.toBeInTheDocument();
    expect(screen.getByText('dashboard page')).toBeInTheDocument();
  });
});
