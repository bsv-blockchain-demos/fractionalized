/**
 * C-5 regression: the nonce must survive a rejected createAction AND a 401 from the
 * POST. Drives the real Admin component so the ordering can't drift silently.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PrivateKey } from '@bsv/sdk';
import { listPendingKeyMaterial } from '@/lib/pendingKeyMaterial';
import { AUTH_PROOF_PURPOSE } from '@shared/authProofPurposes';

const FIXED_PUBKEY = PrivateKey.fromRandom().toPublicKey().toString();
const FIXED_IDENTITY = '02' + 'ab'.repeat(32);

const mockEnsureWallet = vi.fn().mockResolvedValue(FIXED_IDENTITY);
const mockCreateAction = vi.fn();
const mockWallet = {
  getPublicKey: vi.fn().mockResolvedValue({ publicKey: FIXED_PUBKEY }),
  createAction: (...args: unknown[]) => mockCreateAction(...args),
};

vi.mock('@/context/walletContext', () => ({
  useAuthContext: () => ({ userWallet: mockWallet, ensureWallet: mockEnsureWallet }),
}));

const mockFetchWithAuthProof = vi.fn();
vi.mock('@/lib/authProofClient', () => ({
  fetchWithAuthProof: (...args: unknown[]) => mockFetchWithAuthProof(...args),
}));

vi.mock('@/lib/sessionPreflight', () => ({
  ensureSessionAlive: vi.fn().mockResolvedValue(true),
}));

vi.mock('react-hot-toast', () => ({
  __esModule: true,
  toast: { error: vi.fn(), success: vi.fn() },
  default: { error: vi.fn(), success: vi.fn() },
}));

import { Admin } from '@/components/admin';

function numberInputFor(label: string): HTMLInputElement {
  const field = screen.getByText(label).closest('div')!;
  return field.querySelector('input[type="number"]') as HTMLInputElement;
}

async function renderAndFillAdmin() {
  const { container } = render(<Admin />);

  fireEvent.change(screen.getByPlaceholderText(/^One Bedroom/), { target: { value: 'Test Property' } });
  fireEvent.change(screen.getByPlaceholderText(/^City Center/), { target: { value: 'Test Location' } });
  fireEvent.change(numberInputFor('Price (USD)'), { target: { value: '100000' } });
  fireEvent.change(numberInputFor('Current Valuation (USD)'), { target: { value: '120000' } });
  fireEvent.change(screen.getByPlaceholderText('e.g. 11.92%'), { target: { value: '5%' } });

  const form = container.querySelector('form') as HTMLFormElement;
  await act(async () => {
    fireEvent.submit(form);
  });
}

describe('admin.tsx create-property flow: pendingKeyMaterial ordering', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    mockEnsureWallet.mockResolvedValue(FIXED_IDENTITY);
    mockWallet.getPublicKey.mockResolvedValue({ publicKey: FIXED_PUBKEY });
  });

  afterEach(() => {
    cleanup();
  });

  test('createAction rejecting still leaves the nonce retrievable afterward', async () => {
    mockCreateAction.mockRejectedValue(new Error('wallet offline'));

    await renderAndFillAdmin();

    expect(mockCreateAction).toHaveBeenCalled();
    // fetchWithAuthProof must never be reached: createAction failed before step 2.
    expect(mockFetchWithAuthProof).not.toHaveBeenCalled();

    const records = listPendingKeyMaterial();
    expect(records).toHaveLength(1);
    expect(records[0].purpose).toBe(AUTH_PROOF_PURPOSE.createProperty);
    expect(records[0].txid).toBeUndefined();
  });

  test('a 401 from the authenticated POST still leaves the nonce (with txid) retrievable afterward', async () => {
    mockCreateAction.mockResolvedValue({ txid: 'deadbeef'.repeat(8) });
    mockFetchWithAuthProof.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    });

    await renderAndFillAdmin();

    expect(mockCreateAction).toHaveBeenCalled();
    expect(mockFetchWithAuthProof).toHaveBeenCalled();

    const records = listPendingKeyMaterial();
    expect(records).toHaveLength(1);
    expect(records[0].purpose).toBe(AUTH_PROOF_PURPOSE.createProperty);
    expect(records[0].txid).toBe('deadbeef'.repeat(8));
  });

  test('control: a successful POST clears the record', async () => {
    mockCreateAction.mockResolvedValue({ txid: 'cafebabe'.repeat(8) });
    mockFetchWithAuthProof.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { insertedId: 'prop1' } }),
    });

    await renderAndFillAdmin();

    expect(listPendingKeyMaterial()).toEqual([]);
  });
});
