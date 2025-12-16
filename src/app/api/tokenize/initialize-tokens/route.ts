import { NextResponse } from "next/server";
import { connectToMongo, propertiesCollection } from "../../../../lib/mongo";
import { Transaction } from "@bsv/sdk";
import { broadcastTX } from "../../../../hooks/overlayFunctions";
import { toOutpoint } from "../../../../utils/outpoints";
import { requireAuth } from "../../../../utils/apiAuth";

export async function POST(request: Request) {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const userId = auth.user;
    const body = await request.json();

    // Save the created mint transaction on our backend
    const { mintTx, propertyTokenTxid } = body;

    try {
        await connectToMongo();

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

        const mintOutpoint = toOutpoint(mintTx.txid, 0);
        const propertyTokens = await propertiesCollection.updateOne(
            { _id: property._id },
            {
                $set: {
                    "txids.originalMintTxid": mintOutpoint,
                    "txids.currentOutpoint": mintOutpoint,
                    "txids.paymentTxid": toOutpoint(mintTx.txid, 1),
                    // Keep mintTxid for backward compatibility
                    "txids.mintTxid": mintOutpoint,
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