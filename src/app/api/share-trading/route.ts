import { propertiesCollection, sharesCollection, locksCollection, Shares } from "../../../lib/mongo";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
    const { propertyId, sellerId, buyerId, amount, parentTxid, transferTxid } = await request.json();

    let lockId: ObjectId | null = null;
    try {
        if (!ObjectId.isValid(propertyId) || !ObjectId.isValid(sellerId) || !ObjectId.isValid(buyerId)) {
            return NextResponse.json({ error: "Invalid ids" }, { status: 400 });
        }
        if (typeof amount !== 'number' || amount <= 0) {
            return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
        }

        const propertyObjectId = new ObjectId(propertyId);

        // Acquire lock per (property, seller)
        try {
            const lockRes = await locksCollection.insertOne({
                _id: new ObjectId(),
                propertyId: propertyObjectId,
                investorId: sellerId,
                createdAt: new Date(),
            });
            lockId = lockRes.insertedId;
        } catch (e: any) {
            if (e?.code === 11000) {
                return NextResponse.json({ error: "Another transfer is in progress for this seller and property" }, { status: 409 });
            }
            throw e;
        }

        const property = await propertiesCollection.findOne({ _id: propertyObjectId });
        if (!property) {
            throw new Error("Property not found");
        }
        if (!property?.txids?.tokenTxid || !property?.txids?.mintTxid) {
            throw new Error("Property token/payment UTXOs not initialized");
        }

        const formattedShare: Shares = {
            _id: new ObjectId(),
            propertyId: propertyObjectId,
            investorId: buyerId,
            amount,
            parentTxid,
            transferTxid,
            createdAt: new Date(),
        };
        const share = await sharesCollection.insertOne(formattedShare);
        return NextResponse.json({ share });
    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    } finally {
        try {
            if (lockId) {
                await locksCollection.deleteOne({ _id: lockId });
            }
        } catch {}
    }
}