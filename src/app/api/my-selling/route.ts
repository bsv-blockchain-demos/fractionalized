import { NextResponse } from "next/server";
import { connectToMongo, propertiesCollection } from "../../../lib/mongo";
import { requireAuth } from "../../../utils/apiAuth";

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
  const userIdFromToken = auth.user;
  try {
    await connectToMongo();

    // Use authenticated user from token
    const userId: string = userIdFromToken;

    // seller is stored as a string pubkey in the properties collection
    const items = await propertiesCollection.find({ seller: userId }).toArray();

    return NextResponse.json({ items });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

