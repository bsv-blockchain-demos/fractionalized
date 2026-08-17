import toast from 'react-hot-toast';
import { logger } from '@shared/logger';

jest.mock('@/utils/apiFetch', () => ({ apiFetch: jest.fn() }));
jest.mock('@/utils/navigateToLogin', () => ({ navigateToLogin: jest.fn() }));
jest.mock('react-hot-toast', () => ({ __esModule: true, default: { error: jest.fn(), success: jest.fn() } }));

import { apiFetch } from '@/utils/apiFetch';
import { navigateToLogin } from '@/utils/navigateToLogin';
import { ensureSessionAlive } from '@/utils/sessionPreflight';

const mockApiFetch = apiFetch as jest.Mock;
const mockNavigate = navigateToLogin as jest.Mock;

describe('ensureSessionAlive', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns true and does not redirect when authenticated', async () => {
    mockApiFetch.mockResolvedValue({ json: async () => ({ authenticated: true }) });

    const result = await ensureSessionAlive();

    expect(result).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('toasts, redirects to /login, and returns false when not authenticated', async () => {
    mockApiFetch.mockResolvedValue({ json: async () => ({ authenticated: false }) });

    const result = await ensureSessionAlive();

    expect(result).toBe(false);
    expect(toast.error).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  test('fails CLOSED (returns false) and warns when the check-session request itself throws', async () => {
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
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
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
    mockApiFetch.mockResolvedValue({ json: async () => { throw new Error('not json'); } });

    expect(await ensureSessionAlive()).toBe(false);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('a missing/non-true authenticated field is not treated as authenticated', async () => {
    mockApiFetch.mockResolvedValue({ json: async () => ({}) });

    expect(await ensureSessionAlive()).toBe(false);
  });

  test('calls apiFetch with /api/check-session', async () => {
    mockApiFetch.mockResolvedValue({ json: async () => ({ authenticated: true }) });
    await ensureSessionAlive();
    expect(mockApiFetch).toHaveBeenCalledWith('/api/check-session');
  });
});
