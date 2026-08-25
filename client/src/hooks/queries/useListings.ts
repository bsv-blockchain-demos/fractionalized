import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/apiFetch';
import { qk } from '@/lib/queryKeys';

export type ApiListing = {
  _id: string;
  propertyId: string;
  sellerId: string;
  shareId: string;
  sellAmount: number;
  pricePerShare: number;
  name: string;
  location: string;
  images?: string[];
};

export function useListings() {
  return useQuery({
    queryKey: qk.listings(),
    queryFn: async (): Promise<ApiListing[]> => {
      const res = await apiFetch('/api/listings');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return Array.isArray(data?.items) ? data.items : [];
    },
  });
}
