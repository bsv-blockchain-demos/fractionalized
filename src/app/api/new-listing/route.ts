import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { connectToMongo, propertiesCollection, sharesCollection, marketItemsCollection, locksCollection, listingBeefsCollection, Shares, MarketItem, ListingBeef } from "../../../lib/mongo";
import { requireAuth } from "../../../utils/apiAuth";
import { traceShareChain } from "../../../utils/shareChain";
import { Transaction, PublicKey } from "@bsv/sdk";
import { OrdinalsP2MS } from "../../../utils/ordinalsP2MS";
import { hashFromPubkeys } from "../../../utils/hashFromPubkeys";
import { decodeBeef } from "../../../utils/beefEncoding";

export async function POST(request: Request) {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const userIdFromToken = auth.user;
    const { propertyId, sellerId, amount, parentTxid, transferTxid, pricePerShare, listingBeef, listingNonce, sellerChild, serverChild } = await request.json();

    // Identity check: a user can only create listings for themselves
    if (sellerId !== userIdFromToken) {
        return NextResponse.json({ error: "You can't create listings for someone else" }, { status: 403 });
    }

    let lockId: ObjectId | null = null;
    try {
        await connectToMongo();

        if (!ObjectId.isValid(propertyId)) {
            return NextResponse.json({ error: "Invalid ids" }, { status: 400 });
        }
        if (typeof amount !== 'number' || amount <= 0) {
            return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
        }

        const propertyObjectId = new ObjectId(propertyId);

        const property = await propertiesCollection.findOne({ _id: propertyObjectId });
        if (!property) {
            throw new Error("Property not found");
        }
        if (!property?.txids?.tokenTxid || (!property?.txids?.originalMintTxid && !property?.txids?.mintTxid)) {
            throw new Error("Property token/payment UTXOs not initialized");
        }

        // Validate the client-built listing tx and back up its BEEF (overlay-independent buy/cancel).
        if (!listingBeef || !listingNonce || !sellerChild || !serverChild) {
            return NextResponse.json({ error: "Missing listing derivation/beef" }, { status: 400 });
        }

        let listingTx: Transaction;
        try {
            listingTx = Transaction.fromBEEF(decodeBeef(listingBeef));
        } catch {
            return NextResponse.json({ error: "Invalid listing beef" }, { status: 400 });
        }

        // The listing tx must spend the share at `parentTxid` (txid.vout).
        const [parentTxidPart, parentVoutPart] = String(parentTxid).split(".");
        const parentVout = Number(parentVoutPart);
        const spendsParent = listingTx.inputs.some(
            (i) => (i.sourceTXID || i.sourceTransaction?.id('hex')) === parentTxidPart && i.sourceOutputIndex === parentVout
        );
        if (!spendsParent) {
            return NextResponse.json({ error: "Listing tx does not spend the seller's share" }, { status: 400 });
        }

        // Output 0 must byte-match the expected multisig(seller+server) lock — mirror the client's lock args exactly.
        const expectedLock = new OrdinalsP2MS().lock(
            hashFromPubkeys([PublicKey.fromString(sellerChild), PublicKey.fromString(serverChild)]),
            String(parentTxid).replace(".", "_"),
            property.txids.tokenTxid,
            amount,
            "transfer"
        ).toHex();
        const actualLock = listingTx.outputs[0]?.lockingScript?.toHex();
        if (actualLock !== expectedLock) {
            return NextResponse.json({ error: "Listing output does not match expected multisig" }, { status: 400 });
        }

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

        const chainResult = await traceShareChain({ propertyId, leafTransferTxid: parentTxid });

        if (!chainResult.valid) {
            return NextResponse.json({ error: chainResult.reason }, { status: 400 });
        }

        const formattedShare: Shares = {
            _id: new ObjectId(),
            propertyId: propertyObjectId,
            investorId: sellerId,
            amount,
            parentTxid,
            transferTxid,
            createdAt: new Date(),
        };
        const share = await sharesCollection.insertOne(formattedShare);

        // Listing multisig derivation, server's perspective (it spends deriving against the seller).
        const marketItem: MarketItem = {
            _id: new ObjectId(),
            propertyId: propertyObjectId,
            sellerId,
            shareId: share.insertedId,
            sellAmount: amount,
            pricePerShare,
            createdAt: new Date(),
            keyId: listingNonce,
            counterparty: sellerId,
            counterpartyDerivedKey: sellerChild,
            order: 'self-second',
        };
        const listing = await marketItemsCollection.insertOne(marketItem);

        // Back up the listing tx BEEF so buy/cancel don't depend on the overlay.
        const listingBeefDoc: ListingBeef = {
            listingId: listing.insertedId.toString(),
            listingOutpoint: transferTxid,
            beef: listingBeef,
            createdAt: new Date(),
        };
        await listingBeefsCollection.insertOne(listingBeefDoc);

        return NextResponse.json({ share, listing });
    } catch (e) {
        console.error(e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    } finally {
        if (lockId) {
            await locksCollection.deleteOne({ _id: lockId });
        }
    }
}