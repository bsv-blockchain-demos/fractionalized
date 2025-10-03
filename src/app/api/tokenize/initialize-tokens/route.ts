import { NextResponse } from "next/server";
import { propertiesCollection } from "../../../../lib/mongo";
import { Transaction } from "@bsv/sdk";
import { broadcastTX } from "../../../../hooks/overlayFunctions";
import { toOutpoint } from "../../../../utils/outpoints";

export async function POST(request: Request) {
    const body = await request.json();

    // Save the created mint transaction on our backend
    const { mintTx, propertyTokenTxid } = body;

    try {
        // Validate and save mint transaction UTXO
        const property = await propertiesCollection.findOne({
            "txids.tokenTxid": propertyTokenTxid
        });
        if (!property) {
            return NextResponse.json({ error: "Failed to find property, please try again" }, { status: 500 });
        }

        // Broadcast the ordinalToken transaction to the Overlay for later lookup
        const tx = Transaction.fromBEEF(mintTx.tx);
        const overlayResponse = await broadcastTX(tx);

        if (overlayResponse.status !== "success") {
            console.log(`Failed to broadcast transaction for ${mintTx.txid}`);
        }

        const propertyTokens = await propertiesCollection.updateOne(
            { _id: property._id },
            {
                $set: {
                    "txids.mintTxid": toOutpoint(mintTx.txid, 0),
                    "txids.paymentTxid": toOutpoint(mintTx.txid, 1),
                },
            }
        );
        if (!propertyTokens.acknowledged) {
            return NextResponse.json({ error: "Failed to update property, please try again" }, { status: 500 });
        }

        return NextResponse.json({ success: true, status: 200, data: property });
    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: "Failed to initialize tokens, please try again" }, { status: 500 });
    }
}