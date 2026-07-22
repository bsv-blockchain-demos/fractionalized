import { NextResponse } from "next/server";
import { verifyRequestProof } from "../src/utils/apiAuthProof";

// These cover the synchronous guard branches only — no crypto/wallet needed.
// (protoWallet is lazy-imported AFTER these guards, so the key is never required here.)
test("missing proof → 401", async () => {
  const res = await verifyRequestProof({}, "p", "user1");
  expect(res).toBeInstanceOf(NextResponse);
  expect((res as NextResponse).status).toBe(401);
});

test("non-string walletIdentityKey → 401", async () => {
  const res = await verifyRequestProof({ proof: { sig: "x" }, walletIdentityKey: 123 as unknown as string }, "p", "user1");
  expect(res).toBeInstanceOf(NextResponse);
  expect((res as NextResponse).status).toBe(401);
});
