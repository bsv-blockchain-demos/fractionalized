import { NextResponse } from "next/server";
import { authServer } from "@shared/authProof";
import { consumeNonce } from "../lib/authNonceStore";

export async function verifyRequestProof(
  body: { proof?: unknown; walletIdentityKey?: unknown } | null | undefined,
  purpose: string,
  cookieUser: string,
): Promise<{ identityKey: string } | NextResponse> {
  const proof = body?.proof;
  const walletIdentityKey = body?.walletIdentityKey;
  if (!proof || typeof walletIdentityKey !== "string") {
    return NextResponse.json({ error: "Missing auth proof" }, { status: 401 });
  }
  const { default: protoWallet } = await import("../lib/protoWallet");
  const result = await authServer.verifyAuthProof(protoWallet, proof as never, purpose, { consumeNonce });
  if (!result.valid || result.identityKey !== walletIdentityKey || result.identityKey !== cookieUser) {
    return NextResponse.json({ error: result.error ?? "Invalid auth proof" }, { status: 401 });
  }
  return { identityKey: result.identityKey };
}
