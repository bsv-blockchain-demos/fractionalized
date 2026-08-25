export type PropertiesQuery = {
  page: number;
  limit: number;
  sortBy: string;
  activeStatus: string;
  filters: string;
};

/**
 * The only place query keys are constructed. Private keys are identity-FIRST so
 * `removeQueries({ queryKey: ['identity', pk] })` drops exactly one user's data.
 */
export const qk = {
  properties: (params: PropertiesQuery) => ['properties', params] as const,
  property: (id: string) => ['property', id] as const,
  listings: () => ['listings'] as const,
  myShares: (identity: string) => ['identity', identity, 'my-shares'] as const,
  myListings: (identity: string) => ['identity', identity, 'my-listings'] as const,
  mySelling: (identity: string) => ['identity', identity, 'my-selling'] as const,
};
