import { sharesCollection } from "../../../lib/mongo";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
    const { propertyId, investorId, amount } = await request.json();

    // Verify the purchase and make a blockchain transaction
    // Create new 1satOrdinal from the property UTXO

    //const share = await sharesCollection.insertOne({ propertyId, investorId, amount });
    return NextResponse.json({});
}