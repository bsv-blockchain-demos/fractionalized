import { propertiesCollection, propertyDescriptionsCollection } from "../../../../lib/mongo";
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
    // Split fields destined for property_descriptions
    const { description, whyInvest, ...rest } = data || {};

    // Follow properties interface but skip _id
    const formattedPropertyData: Properties = {
        ...rest,
        txids: {
            TokenTxid: `${tx.txid}.0`,
        },
        seller,
    };

    // Save property core document
    const propertyInsert = await propertiesCollection.insertOne(formattedPropertyData);
    if (!propertyInsert.acknowledged) {
        return NextResponse.json({ error: "Failed to save property, please try again" }, { status: 500 });
    }

    // Save extended description in separate collection (optional, only if provided)
    try {
        if (description || (whyInvest && Array.isArray(whyInvest))) {
            await propertyDescriptionsCollection.insertOne({
                propertyId: propertyInsert.insertedId,
                description: {
                    details: description?.details || "",
                    features: Array.isArray(description?.features) ? description.features : [],
                },
                whyInvest: Array.isArray(whyInvest)
                    ? whyInvest.map((w: any) => ({ title: String(w?.title || ""), text: String(w?.text || "") }))
                    : undefined,
            });
        }
    } catch (e) {
        // If the description insert fails, we won't fail the whole operation; log and proceed
        console.warn("Failed to insert property description:", e);
    }

    return NextResponse.json({ success: true, status: 200, data: propertyInsert });
}