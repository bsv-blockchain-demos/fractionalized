import { NextResponse } from "next/server";

export async function POST(request: Request) {
    const body = await request.json();

    // Create 1satOrdinals for each share with inscription data { % amount per share }

    return NextResponse.json({});
}