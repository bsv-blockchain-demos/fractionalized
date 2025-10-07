import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify, errors } from "jose";

interface RequestCookie {
  name: string;
  value: string;
}

const SECRET = process.env.JWT_SECRET as string;

export async function middleware(req: NextRequest) {
  const token = (req.cookies.get("verified") as RequestCookie)?.value;

  // Public routes (don't require auth)
  const publicPaths = ["/login"];
  const isPublic = publicPaths.some((path) => req.nextUrl.pathname.startsWith(path));

  if (isPublic) {
    if (token && req.url.includes("/login")) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    return NextResponse.next();
  }

  if (!token && !isPublic) {
    // Not authenticated → redirect to login
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const secret = new TextEncoder().encode(SECRET);

  try {
    await jwtVerify(token, secret);
  } catch (error) {
    const res = NextResponse.redirect(new URL("/login", req.url));
    if (error instanceof errors.JWTExpired) {
      res.cookies.delete("verified");
    } else if (error instanceof errors.JWTInvalid) {
      res.cookies.delete("verified");
    } else if (error instanceof errors.JWSSignatureVerificationFailed) {
      res.cookies.delete("verified");
    }
    console.error("error", error);
    return res;
  }

  return NextResponse.next();
}

// Match all routes except static files, api routes, etc.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api).*)"],
};