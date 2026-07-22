export const AUTH_PROOF_PURPOSE = {
  myShares: "fetch-my-shares",
  myListings: "fetch-my-listings",
  mySelling: "fetch-my-selling",
} as const;

export type AuthProofPurpose = (typeof AUTH_PROOF_PURPOSE)[keyof typeof AUTH_PROOF_PURPOSE];
