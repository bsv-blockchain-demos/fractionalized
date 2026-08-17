import { describe, test, expect, beforeEach, vi } from 'vitest';
import toast from 'react-hot-toast';
import { logger } from '@shared/logger';

vi.mock('@/lib/apiFetch', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/navigateToLogin', () => ({ navigateToLogin: vi.fn() }));
vi.mock('react-hot-toast', () => ({ __esModule: true, default: { error: vi.fn(), success: vi.fn() } }));

import { apiFetch } from '@/lib/apiFetch';
import { navigateToLogin } from '@/lib/navigateToLogin';
import { ensureSessionAlive } from '@/lib/sessionPreflight';

const mockApiFetch = vi.mocked(apiFetch);
const mockNavigate = vi.mocked(navigateToLogin);

describe('ensureSessionAlive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns true and does not redirect when authenticated', async () => {
    mockApiFetch.mockResolvedValue({ json: async () => ({ authenticated: true }) } as Response);

    const result = await ensureSessionAlive();

    expect(result).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('toasts, redirects to /login, and returns false when not authenticated', async () => {
    mockApiFetch.mockResolvedValue({ json: async () => ({ authenticated: false }) } as Response);

    const result = await ensureSessionAlive();

    expect(result).toBe(false);
    expect(toast.error).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  test('fails CLOSED (returns false) and warns when the check-session request itself throws', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    mockApiFetch.mockRejectedValue(new Error('network down'));

    const result = await ensureSessionAlive();

    // Refusing to spend is the point: an unreachable check-session means the POST would fail too.
    expect(result).toBe(false);
    expect(toast.error).toHaveBeenCalled();
    // Retryable, not expired — must NOT dump the user on /login.
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  test('fails CLOSED when the response body is not JSON', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    mockApiFetch.mockResolvedValue({ json: async () => { throw new Error('not json'); } } as unknown as Response);

    expect(await ensureSessionAlive()).toBe(false);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('a missing/non-true authenticated field is not treated as authenticated', async () => {
    mockApiFetch.mockResolvedValue({ json: async () => ({}) } as Response);

    expect(await ensureSessionAlive()).toBe(false);
  });

  test('calls apiFetch with /api/check-session', async () => {
    mockApiFetch.mockResolvedValue({ json: async () => ({ authenticated: true }) } as Response);
    await ensureSessionAlive();
    expect(mockApiFetch).toHaveBeenCalledWith('/api/check-session');
  });
});
