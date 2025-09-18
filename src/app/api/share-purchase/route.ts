import { sharesCollection } from "../../../lib/mongo";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
    const { propertyId, investorId, amount } = await request.json();

    // Verify the purchase and make a blockchain transaction
    // Spend one of the 100 outpoints in the sourceTX (from property) and link to the user (investor)

    //const share = await sharesCollection.insertOne({ propertyId, investorId, amount });
    return NextResponse.json({});
}