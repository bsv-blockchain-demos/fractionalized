import { propertiesCollection, propertyDescriptionsCollection } from "../../../../lib/mongo";
import { NextResponse } from "next/server";
import { Properties } from "../../../../lib/mongo";

export async function POST(request: Request) {
    const { data, tx, seller } = await request.json();

    // Enforce server-side limits (must match validators.ts)
    const MAX_DETAILS = 1500;
    const MAX_WHY_TITLE = 80;
    const MAX_WHY_TEXT = 400;
    const MAX_TITLE = 80;
    const MAX_LOCATION = 80;
    try {
        const { description, whyInvest, title, location } = data || {};
        const errors: string[] = [];
        // Title & Location
        const t = String(title ?? "").trim();
        const loc = String(location ?? "").trim();
        if (!t) errors.push("title is required");
        if (!loc) errors.push("location is required");
        if (t.length > MAX_TITLE) errors.push(`title too long (${t.length}/${MAX_TITLE})`);
        if (loc.length > MAX_LOCATION) errors.push(`location too long (${loc.length}/${MAX_LOCATION})`);
        // Textual limits
        const detailsLen = (description?.details || "").length;
        if (detailsLen > MAX_DETAILS) {
            errors.push(`Description details too long (${detailsLen}/${MAX_DETAILS})`);
        }
        if (Array.isArray(whyInvest)) {
            whyInvest.forEach((w: any, idx: number) => {
                const tlen = String(w?.title || "").length;
                const xlen = String(w?.text || "").length;
                if (tlen > MAX_WHY_TITLE) errors.push(`whyInvest[${idx}].title too long (${tlen}/${MAX_WHY_TITLE})`);
                if (xlen > MAX_WHY_TEXT) errors.push(`whyInvest[${idx}].text too long (${xlen}/${MAX_WHY_TEXT})`);
            });
        }

        // Numeric sanity checks (avoid pathological values)
        const MAX_CURRENCY = 1e12; // AED cap ~ 1 trillion
        const MAX_INVESTORS = 1e7; // 10 million investors cap
        const isValidCurrency = (n: any) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= MAX_CURRENCY;
        const isValidInteger = (n: any) => Number.isInteger(n) && n >= 0;

        const currencyChecks: Array<[string, any]> = [
            ["priceAED", data?.priceAED],
            ["currentValuationAED", data?.currentValuationAED],
            ["investmentBreakdown.purchaseCost", data?.investmentBreakdown?.purchaseCost],
            ["investmentBreakdown.transactionCost", data?.investmentBreakdown?.transactionCost],
            ["investmentBreakdown.runningCost", data?.investmentBreakdown?.runningCost],
        ];
        currencyChecks.forEach(([name, value]) => {
            if (value != null && !isValidCurrency(value)) {
                errors.push(`${name} must be a finite, non-negative number <= ${MAX_CURRENCY}`);
            }
        });
        if (data?.investors != null) {
            if (!isValidInteger(data.investors) || data.investors > MAX_INVESTORS) {
                errors.push(`investors must be a non-negative integer <= ${MAX_INVESTORS}`);
            }
        }
        if (errors.length > 0) {
            return NextResponse.json({ error: "Validation failed", details: errors }, { status: 400 });
        }
    } catch {}

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