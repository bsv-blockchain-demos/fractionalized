/**
 * @jest-environment jsdom
 *
 * C-5 regression: the nonce must survive a rejected createAction AND a 401 from the
 * POST. Drives the real Admin component so the ordering can't drift silently.
 */
// @bsv/sdk touches global fetch at import time; jsdom has none, so define it first.
if (typeof (globalThis as any).fetch === 'undefined') {
  (globalThis as any).fetch = () => Promise.reject(new Error('fetch should not be called in this test'));
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PrivateKey } from '@bsv/sdk';
import { listPendingKeyMaterial } from '@/utils/pendingKeyMaterial';
import { AUTH_PROOF_PURPOSE } from '@shared/authProofPurposes';

const FIXED_PUBKEY = PrivateKey.fromRandom().toPublicKey().toString();
const FIXED_IDENTITY = '02' + 'ab'.repeat(32);

const mockEnsureWallet = jest.fn().mockResolvedValue(FIXED_IDENTITY);
const mockCreateAction = jest.fn();
const mockWallet = {
  getPublicKey: jest.fn().mockResolvedValue({ publicKey: FIXED_PUBKEY }),
  createAction: (...args: unknown[]) => mockCreateAction(...args),
};

jest.mock('@/context/walletContext', () => ({
  useAuthContext: () => ({ userWallet: mockWallet, ensureWallet: mockEnsureWallet }),
}));

const mockFetchWithAuthProof = jest.fn();
jest.mock('@/utils/authProofClient', () => ({
  fetchWithAuthProof: (...args: unknown[]) => mockFetchWithAuthProof(...args),
}));

jest.mock('@/utils/sessionPreflight', () => ({
  ensureSessionAlive: jest.fn().mockResolvedValue(true),
}));

jest.mock('react-hot-toast', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn() },
}));

import { Admin } from '@/components/admin';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setInputValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function renderAndFillAdmin(container: HTMLDivElement, root: Root) {
  await act(async () => {
    root.render(React.createElement(Admin));
  });

  const title = container.querySelector('input[placeholder^="One Bedroom"]') as HTMLInputElement;
  const location = container.querySelector('input[placeholder^="City Center"]') as HTMLInputElement;
  const inputs = Array.from(container.querySelectorAll('input[type="number"]')) as HTMLInputElement[];
  const priceInput = inputs[0]; // Price (USD)
  const valuationInput = inputs[1]; // Current Valuation (USD)
  const returnInput = container.querySelector('input[placeholder="e.g. 11.92%"]') as HTMLInputElement;

  await act(async () => {
    setInputValue(title, 'Test Property');
    setInputValue(location, 'Test Location');
    setInputValue(priceInput, '100000');
    setInputValue(valuationInput, '120000');
    setInputValue(returnInput, '5%');
  });

  const form = container.querySelector('form') as HTMLFormElement;
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
  });
}

describe('admin.tsx create-property flow: pendingKeyMaterial ordering', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.clear();
    jest.clearAllMocks();
    mockEnsureWallet.mockResolvedValue(FIXED_IDENTITY);
    mockWallet.getPublicKey.mockResolvedValue({ publicKey: FIXED_PUBKEY });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
  });

  test('createAction rejecting still leaves the nonce retrievable afterward', async () => {
    mockCreateAction.mockRejectedValue(new Error('wallet offline'));

    await renderAndFillAdmin(container, root);

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

    await renderAndFillAdmin(container, root);

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

    await renderAndFillAdmin(container, root);

    expect(listPendingKeyMaterial()).toEqual([]);
  });
});
