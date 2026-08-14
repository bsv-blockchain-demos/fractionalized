export const AUTH_PROOF_PURPOSE = {
  myShares: "fetch-my-shares",
  myListings: "fetch-my-listings",
  mySelling: "fetch-my-selling",
  createProperty: "create-property",
  sharePurchase: "share-purchase",
  newListing: "new-listing",
  listingPurchase: "listing-purchase",
  cancelListing: "cancel-listing",
} as const;

export type AuthProofPurpose = (typeof AUTH_PROOF_PURPOSE)[keyof typeof AUTH_PROOF_PURPOSE];
