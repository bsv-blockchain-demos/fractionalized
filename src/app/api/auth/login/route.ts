import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SignJWT } from "jose";
import { createSecretKey } from "crypto";

const SECRET = process.env.JWT_SECRET as string;

export async function POST(request: Request) {
    const body = await request.json();
    if (body.request !== "login") {
        return NextResponse.json({ message: 'Invalid request' }, { status: 400 });
    }

    // After successful response create JWT cookie
    const jwt = new SignJWT({
        user: body.userPubKey,
    });
    jwt.setProtectedHeader({ alg: "HS256" });
    jwt.setExpirationTime("1d");

    const secret = createSecretKey(Buffer.from(SECRET, "utf-8"));
    const token = await jwt.sign(secret);

    const cookieStore = await cookies();
    cookieStore.set("verified", token, {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        path: "/",
        expires: new Date(Date.now() + 1440 * 60 * 1000), // 1 day
    });

    // Return success response (user data)
    return NextResponse.json({ user: body.userPubKey }, { status: 200 });
}