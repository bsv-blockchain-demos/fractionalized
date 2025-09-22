import { propertiesCollection } from "../../../../lib/mongo";
import { Hash } from "@bsv/sdk";
import { makeWallet } from "../../../../lib/serverWallet";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
    const { title, location, priceAED, investors, status, annualisedReturn, currentValuationAED, grossYield, netYield, investmentBreakdown, description, features, images, seller } = await request.json();
    const fields = {
        title,
        location,
        priceAED,
        investors,
        status,
        annualisedReturn,
        currentValuationAED,
        grossYield,
        netYield,
        investmentBreakdown,
        description,
        features,
        images,
        seller,
    };

    const nullFields = Object.entries(fields)
        .filter(([_, value]) => value === null)
        .map(([key]) => key);

    if (nullFields.length > 0) {
        return NextResponse.json({ error: `Missing required fields: ${nullFields.join(', ')}` }, { status: 400 });
    }

    // Format and verify all inputs to satisfy Mongo interface
    // Validate and safe tokenized transaction UTXO

    const sellerKeyHash = Hash.hash160(seller.toString(), "hex");

    //const property = await propertiesCollection.insertOne({ formattedProperty });
    return NextResponse.json({});
}