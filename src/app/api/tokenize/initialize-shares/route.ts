import { NextResponse } from "next/server";

export async function POST(request: Request) {
    const body = await request.json();

    // Transfer the ordinal tokens to the server wallet with multi-sig

    return NextResponse.json({});
}