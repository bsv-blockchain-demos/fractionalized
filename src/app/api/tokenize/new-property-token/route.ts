import { propertiesCollection } from "../../../../lib/mongo";
import { NextResponse } from "next/server";
import { Properties } from "../../../../lib/mongo";

export async function POST(request: Request) {
    const { data, tx, seller } = await request.json();

    const nullFields = Object.entries(data)
        .filter(([_, value]) => value === null)
        .map(([key]) => key);

    if (nullFields.length > 0) {
        return NextResponse.json({ error: `Missing required fields: ${nullFields.join(', ')}` }, { status: 400 });
    }

    // Format and verify all inputs to satisfy Mongo interface
    // Follow properties interface but skip _id
    const formattedPropertyData: Properties = {
        ...data,
        TokenTxid: `${tx.txid}.0`,
        seller,
    };
    // Validate and save tokenized transaction UTXO
    const property = await propertiesCollection.insertOne(formattedPropertyData);
    if (!property.acknowledged) {
        return NextResponse.json({ error: "Failed to save property, please try again" }, { status: 500 });
    }
    return NextResponse.json({ success: true, status: 200, data: property });
}