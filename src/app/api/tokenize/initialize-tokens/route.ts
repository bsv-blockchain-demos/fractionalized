import { NextResponse } from "next/server";
import { propertiesCollection } from "../../../../lib/mongo";

export async function POST(request: Request) {
    const body = await request.json();

    // Save the created mint transaction on our backend
    const { mintTx, paymentTx, propertyTokenTxid } = body;

    // Validate and save mint transaction UTXO
    const property = await propertiesCollection.findOne({
        "txids.TokenTxid": propertyTokenTxid
    });
    if (!property) {
        return NextResponse.json({ error: "Failed to find property, please try again" }, { status: 500 });
    }

    const propertyTokens = await propertiesCollection.updateOne(
        { _id: property._id },
        {
            $set: {
                "txids.mintTxid": mintTx.txid,
                "txids.paymentTxid": paymentTx.txid,
            },
        }
    );
    if (!propertyTokens.acknowledged) {
        return NextResponse.json({ error: "Failed to update property, please try again" }, { status: 500 });
    }

    return NextResponse.json({ success: true, status: 200, data: property });
}