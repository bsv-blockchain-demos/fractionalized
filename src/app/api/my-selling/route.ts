import { NextResponse } from "next/server";
import { connectToMongo, propertiesCollection } from "../../../lib/mongo";

export async function POST(request: Request) {
  try {
    await connectToMongo();

    const body = await request.json().catch(() => ({}));
    const userId: string | undefined = body.userId || body.sellerId || body.investorId;

    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    // seller is stored as a string pubkey in the properties collection
    const items = await propertiesCollection
      .find({ seller: userId })
      .toArray();

    return NextResponse.json({ items });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

