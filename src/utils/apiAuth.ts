import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { getJwtSecret } from "../lib/config";
import { logger } from "./logger";

export type AuthResult = { user: string };

// 401 that also clears the invalid/expired `verified` cookie, so a client isn't stuck
// re-sending a bad token; the next page navigation then hits middleware → clean /login redirect.
function unauthorized(clearCookie: boolean): NextResponse {
  const res = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (clearCookie) res.cookies.delete("verified");
  return res;
}

export async function requireAuth(req: Request): Promise<AuthResult | NextResponse> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("verified")?.value;

    if (!token) {
      return unauthorized(false); // no cookie to clear
    }

    const secret = new TextEncoder().encode(getJwtSecret());
    const { payload } = await jwtVerify(token, secret);

    if (!payload.user || typeof payload.user !== "string") {
      return unauthorized(true); // signed but malformed → clear it
    }

    return { user: payload.user };
  } catch (error) {
    // Expired/invalid/tampered token → clear the bad cookie.
    logger.error("JWT error", error);
    return unauthorized(true);
  }
}
