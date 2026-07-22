import { NextResponse } from "next/server";
import { connectToMongo, propertiesCollection } from "../../../lib/mongo";
import { requireAuth } from "../../../utils/apiAuth";
import { toPublicProperty } from "../../../lib/serializers";
import { buildFacetPipeline } from "../../../lib/propertiesPipeline";

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const body = await request.json();

    await connectToMongo();

    const pipeline = buildFacetPipeline(body);
    const [res] = await propertiesCollection.aggregate(pipeline).toArray();
    const rawItems = res?.items || [];
    const items = rawItems.map((it: any) =>
      toPublicProperty(it, { availablePercent: it.availablePercent, totalSold: it.totalSold, investors: it.investors }),
    );
    const total = (res?.total?.[0]?.count as number) || 0;

    return NextResponse.json({ items, total, page: body.page ?? 1, limit: body.limit ?? 20 });
  } catch (e: any) {
    console.error("/api/properties error:", e);
    return NextResponse.json({ error: "Failed to fetch properties" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const { searchParams } = new URL(request.url);
    const page = Number(searchParams.get("page") || 1);
    const limit = Number(searchParams.get("limit") || 20);
    const sortBy = searchParams.get("sortBy") || "price_desc";
    const activeStatus = searchParams.get("activeStatus") || "all";
    const filtersParam = searchParams.get("filters");
    let filters: any = {};
    if (filtersParam) {
      try { filters = JSON.parse(filtersParam); } catch {}
    }

    await connectToMongo();

    const pipeline = buildFacetPipeline({ page, limit, sortBy, activeStatus, filters });
    const [res] = await propertiesCollection.aggregate(pipeline).toArray();
    const rawItems = res?.items || [];
    const items = rawItems.map((it: any) =>
      toPublicProperty(it, { availablePercent: it.availablePercent, totalSold: it.totalSold, investors: it.investors }),
    );
    const total = (res?.total?.[0]?.count as number) || 0;

    return NextResponse.json({ items, total, page, limit });
  } catch (e) {
    console.error("/api/properties GET error:", e);
    return NextResponse.json({ error: "Failed to fetch properties" }, { status: 500 });
  }
}
