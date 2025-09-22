import { propertiesCollection } from "../../../lib/mongo";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
    const { title, location, priceAED, investors, status, annualisedReturn, currentValuationAED, grossYield, netYield, investmentBreakdown, description, features, images } = await request.json();

    // Format and verify all inputs to satisfy Mongo interface
    // Create tokenized transaction with minted shares for property

    //const property = await propertiesCollection.insertOne({ title, location, priceAED, investors, status, annualisedReturn, currentValuationAED, grossYield, netYield, investmentBreakdown, description, features, images });
    return NextResponse.json({});
}