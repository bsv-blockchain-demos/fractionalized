import { useQueries, useQuery } from '@tanstack/react-query';
import type { Properties, PublicProperty } from '@shared/types';
import { apiFetch } from '@/lib/apiFetch';
import { qk, type PropertiesQuery } from '@/lib/queryKeys';

/** The detail route adds computed fields the list route doesn't carry. */
export type PropertyDetail = Properties & {
  description?: { details: string; features: string[] };
  whyInvest?: { title: string; text: string }[];
  availablePercent?: number | null;
  totalSold?: number;
};

async function getJson(url: string) {
  const res = await apiFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchProperty(id: string): Promise<PropertyDetail | null> {
  const data = await getJson(`/api/properties/${id}`);
  return (data?.item as PropertyDetail) ?? null;
}

/** One query per id, so the detail page, the dashboard loop and the sell modal share it. */
function propertyOptions(id: string) {
  return { queryKey: qk.property(id), queryFn: () => fetchProperty(id) };
}

export function usePropertiesList(params: PropertiesQuery) {
  return useQuery({
    queryKey: qk.properties(params),
    queryFn: async () => {
      const qs = new URLSearchParams({
        page: String(params.page),
        limit: String(params.limit),
        sortBy: params.sortBy,
        activeStatus: params.activeStatus,
        filters: params.filters,
      });
      const data = await getJson(`/api/properties?${qs.toString()}`);
      return {
        items: (data?.items ?? []) as PublicProperty[],
        total: Number(data?.total ?? 0),
      };
    },
  });
}

export function useProperty(id: string | undefined) {
  return useQuery({ ...propertyOptions(id ?? ''), enabled: !!id });
}

export function usePropertiesByIds(ids: string[]) {
  return useQueries({ queries: ids.map((id) => propertyOptions(id)) });
}
