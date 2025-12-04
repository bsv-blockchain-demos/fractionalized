import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { connectToMongo, propertiesCollection, propertyDescriptionsCollection } from "../../../../lib/mongo";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await connectToMongo();

    const { id } = await params;
    if (!id || !ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const _id = new ObjectId(id);
    const property = await propertiesCollection.findOne({ _id });
    if (!property) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    const descriptions = await propertyDescriptionsCollection.findOne({ propertyId: _id });

    const out = {
      ...property,
      _id: property._id.toString(),
      description: descriptions?.description || { details: "", features: [] },
      whyInvest: descriptions?.whyInvest || [],
    };

    return NextResponse.json({ item: out });
  } catch (e) {
    console.error("/api/properties/[id] GET error:", e);
    return NextResponse.json({ error: "Failed to fetch property" }, { status: 500 });
  }
}
