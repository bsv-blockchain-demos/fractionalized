import type { WalletInterface } from '@bsv/sdk';
import { useQuery } from '@tanstack/react-query';
import type { Properties } from '@shared/types';
import { AUTH_PROOF_PURPOSE } from '@shared/authProofPurposes';
import { useAuthContext } from '@/context/walletContext';
import { apiFetchStepUp } from '@/lib/apiFetchStepUp';
import { qk } from '@/lib/queryKeys';
import { STEP_UP_STALE_TIME } from '@/lib/queryClient';

export type OwnedShare = {
  _id: string;
  propertyId: string;
  amount: number; // percent
  transferTxid: string;
  propertyTitle?: string;
  // Share P2PKH derivation (absent for legacy shares).
  keyId?: string;
  counterparty?: string;
};

export type MyListing = {
  _id: string;
  propertyId: string;
  name: string;
  location: string;
  sellAmount: number;
  pricePerShare: number;
  listingNonce?: string;
  listingOutpoint?: string;
  listingBeef?: string;
  tokenTxid?: string;
};

async function postStepUp(url: string, wallet: WalletInterface, purpose: string) {
  const res = await apiFetchStepUp(url, wallet, purpose);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Each of these mints a single-use proof, hence STEP_UP_STALE_TIME and an explicit retry: 0. */
const stepUpDefaults = { staleTime: STEP_UP_STALE_TIME, retry: 0 } as const;

export function myListingsOptions(identity: string, wallet: WalletInterface) {
  return {
    ...stepUpDefaults,
    queryKey: qk.myListings(identity),
    queryFn: async (): Promise<MyListing[]> => {
      const data = await postStepUp('/api/my-listings', wallet, AUTH_PROOF_PURPOSE.myListings);
      const items = Array.isArray(data?.items) ? data.items : [];
      return items.map((i: any) => ({
        _id: String(i?._id ?? ''),
        propertyId: String(i?.propertyId ?? ''),
        name: String(i?.name ?? 'Unknown Property'),
        location: String(i?.location ?? 'Unknown'),
        sellAmount: Number(i?.sellAmount ?? 0),
        pricePerShare: Number(i?.pricePerShare ?? 0),
        listingNonce: i?.listingNonce ? String(i.listingNonce) : undefined,
        listingOutpoint: i?.listingOutpoint ? String(i.listingOutpoint) : undefined,
        listingBeef: i?.listingBeef ? String(i.listingBeef) : undefined,
        tokenTxid: i?.tokenTxid ? String(i.tokenTxid) : undefined,
      }));
    },
  };
}

function mySharesOptions(identity: string, wallet: WalletInterface) {
  return {
    ...stepUpDefaults,
    queryKey: qk.myShares(identity),
    queryFn: async (): Promise<OwnedShare[]> => {
      const data = await postStepUp('/api/my-shares', wallet, AUTH_PROOF_PURPOSE.myShares);
      return ((data?.shares ?? []) as any[]).map((s) => ({
        _id: String(s?._id ?? ''),
        propertyId: String(s?.propertyId ?? ''),
        amount: Number(s?.amount ?? 0),
        transferTxid: String(s?.transferTxid ?? ''),
        propertyTitle: String(s?.propertyTitle ?? ''),
        keyId: s?.keyId ? String(s.keyId) : undefined,
        counterparty: s?.counterparty ? String(s.counterparty) : undefined,
      }));
    },
  };
}

function mySellingOptions(identity: string, wallet: WalletInterface) {
  return {
    ...stepUpDefaults,
    queryKey: qk.mySelling(identity),
    queryFn: async (): Promise<Properties[]> => {
      const data = await postStepUp('/api/my-selling', wallet, AUTH_PROOF_PURPOSE.mySelling);
      return ((data?.items ?? []) as Properties[]).filter(Boolean);
    },
  };
}

/** Never fire before the wallet has restored, or the read fails and burns a nonce for nothing. */
function useStepUpGate(extra = true) {
  const { status, userPubKey, userWallet } = useAuthContext();
  return { identity: userPubKey ?? '', wallet: userWallet, enabled: extra && status === 'authenticated' && !!userPubKey };
}

export function useMyShares(extraEnabled = true) {
  const { identity, wallet, enabled } = useStepUpGate(extraEnabled);
  return useQuery({ ...mySharesOptions(identity, wallet), enabled });
}

export function useMyListings(extraEnabled = true) {
  const { identity, wallet, enabled } = useStepUpGate(extraEnabled);
  return useQuery({ ...myListingsOptions(identity, wallet), enabled });
}

export function useMySelling(extraEnabled = true) {
  const { identity, wallet, enabled } = useStepUpGate(extraEnabled);
  return useQuery({ ...mySellingOptions(identity, wallet), enabled });
}
