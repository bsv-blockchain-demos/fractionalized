import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify, errors } from "jose";

export type AuthResult = { user: string };

export async function requireAuth(req: Request): Promise<AuthResult | NextResponse> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("verified")?.value;

    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const secret = new TextEncoder().encode(process.env.JWT_SECRET as string);
    const { payload } = await jwtVerify(token, secret);

    if (!payload.user || typeof payload.user !== "string") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return { user: payload.user };
  } catch (error) {
    // On any JWT error, redirect to login and clear cookie
    const res = NextResponse.redirect(new URL("/login", req.url));
    if (
      error instanceof errors.JWTExpired ||
      error instanceof errors.JWTInvalid ||
      error instanceof errors.JWSSignatureVerificationFailed
    ) {
      res.cookies.delete("verified");
    }
    console.error("JWT error", error);
    return res;
  }
}
