import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SignJWT } from "jose";
import { createSecretKey } from "crypto";
import protoWallet from "@/lib/protoWallet";
import { authServer } from "@/lib/authProof";
import { consumeNonce } from "@/lib/authNonceStore";

const SECRET = process.env.JWT_SECRET as string;

export async function POST(request: Request) {
    const body = await request.json();
    if (body.request !== "login") {
        return NextResponse.json({ message: 'Invalid request' }, { status: 400 });
    }

    const { userPubKey, proof, walletIdentityKey } = body;

    if (!proof || !walletIdentityKey) {
        return NextResponse.json({ message: 'Missing proof or walletIdentityKey' }, { status: 400 });
    }

    // Signed-proof check — expiry-bound, single-use proof of key ownership
    const proofResult = await authServer.verifyAuthProof(protoWallet, proof, 'login', { consumeNonce });
    if (!proofResult.valid || proofResult.identityKey !== walletIdentityKey) {
        return NextResponse.json({ message: proofResult.error ?? 'Proof identity mismatch' }, { status: 401 });
    }

    // Session id = the proof-validated identity key (what type-42 derivation uses).
    const jwt = new SignJWT({
        user: walletIdentityKey,
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
    return NextResponse.json({ user: userPubKey }, { status: 200 });
}