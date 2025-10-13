import { NextResponse } from "next/server";
import { connectToMongo, propertiesCollection } from "../../../lib/mongo";
import { requireAuth } from "../../../utils/apiAuth";

// Helper to build aggregation pipeline based on filters and sorting, returning a $facet
function buildFacetPipeline(body: any) {
  const {
    page = 1,
    limit = 20,
    filters = {},
    sortBy = "price_desc",
    activeStatus = "all",
  } = body || {};

  const match: Record<string, any> = {};

  // Status handling: active tab and filter set
  if (activeStatus && activeStatus !== "all") {
    match.status = activeStatus;
  }
  if (filters.statuses && Array.isArray(filters.statuses) && filters.statuses.length > 0) {
    match.status = match.status
      ? { $in: filters.statuses.filter((s: string) => s === match.status || match.status == null) }
      : { $in: filters.statuses };
  }

  // Numeric ranges (direct numeric fields)
  if (filters.priceMin != null) match.priceUSD = { ...(match.priceUSD || {}), $gte: Number(filters.priceMin) };
  if (filters.priceMax != null) match.priceUSD = { ...(match.priceUSD || {}), $lte: Number(filters.priceMax) };

  if (filters.investorsMin != null) match.investors = { ...(match.investors || {}), $gte: Number(filters.investorsMin) };
  if (filters.investorsMax != null) match.investors = { ...(match.investors || {}), $lte: Number(filters.investorsMax) };

  // Simple text query
  const q: string = (filters.query || "").trim();
  if (q) {
    match.$or = [
      { title: { $regex: q, $options: "i" } },
      { location: { $regex: q, $options: "i" } },
    ];
  }

  // Stages shared by both facets to compute numeric percent fields
  const addNumericStages = [
    {
      $addFields: {
        grossYieldNum: {
          $cond: [
            { $isArray: "$grossYield" },
            0,
            {
              $convert: {
                input: { $replaceAll: { input: "$grossYield", find: "%", replacement: "" } },
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
          ],
        },
        netYieldNum: {
          $cond: [
            { $isArray: "$netYield" },
            0,
            {
              $convert: {
                input: { $replaceAll: { input: "$netYield", find: "%", replacement: "" } },
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
          ],
        },
        annualisedReturnNum: {
          $cond: [
            { $isArray: "$annualisedReturn" },
            0,
            {
              $convert: {
                input: { $replaceAll: { input: "$annualisedReturn", find: "%", replacement: "" } },
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
          ],
        },
      },
    },
  ];

  // Apply percent range filters if provided
  const percentMatch: Record<string, any> = {};
  if (filters.grossYieldMin != null) percentMatch.grossYieldNum = { ...(percentMatch.grossYieldNum || {}), $gte: Number(filters.grossYieldMin) };
  if (filters.grossYieldMax != null) percentMatch.grossYieldNum = { ...(percentMatch.grossYieldNum || {}), $lte: Number(filters.grossYieldMax) };
  if (filters.netYieldMin != null) percentMatch.netYieldNum = { ...(percentMatch.netYieldNum || {}), $gte: Number(filters.netYieldMin) };
  if (filters.netYieldMax != null) percentMatch.netYieldNum = { ...(percentMatch.netYieldNum || {}), $lte: Number(filters.netYieldMax) };
  if (filters.annualisedReturnMin != null) percentMatch.annualisedReturnNum = { ...(percentMatch.annualisedReturnNum || {}), $gte: Number(filters.annualisedReturnMin) };
  if (filters.annualisedReturnMax != null) percentMatch.annualisedReturnNum = { ...(percentMatch.annualisedReturnNum || {}), $lte: Number(filters.annualisedReturnMax) };

  // Sorting
  const sort: Record<string, 1 | -1> = {};
  switch (sortBy) {
    case "price_asc":
      sort.priceUSD = 1; break;
    case "price_desc":
      sort.priceUSD = -1; break;
    case "valuation_asc":
      sort.currentValuationUSD = 1; break;
    case "valuation_desc":
      sort.currentValuationUSD = -1; break;
    case "investors_asc":
      sort.investors = 1; break;
    case "investors_desc":
      sort.investors = -1; break;
    case "gross_yield_asc":
      sort.grossYieldNum = 1; break;
    case "gross_yield_desc":
      sort.grossYieldNum = -1; break;
    case "net_yield_asc":
      sort.netYieldNum = 1; break;
    case "net_yield_desc":
      sort.netYieldNum = -1; break;
    case "annualised_asc":
      sort.annualisedReturnNum = 1; break;
    case "annualised_desc":
      sort.annualisedReturnNum = -1; break;
    default:
      sort.priceUSD = -1; break;
  }
  const skip = Math.max(0, (Number(page) - 1) * Number(limit));

  // Build $facet pipeline to get items and total in one go
  const facetPipeline: any[] = [];
  if (Object.keys(match).length > 0) {
    facetPipeline.push({ $match: match });
  }
  
  facetPipeline.push({
    $facet: {
      items: [
        ...addNumericStages,
        ...(Object.keys(percentMatch).length > 0 ? [{ $match: percentMatch }] : []),
        { $sort: sort },
        { $skip: skip },
        { $limit: Number(limit) },
        { $set: { _id: { $toString: "$_id" } } },
        { $project: { grossYieldNum: 0, netYieldNum: 0, annualisedReturnNum: 0 } },
      ],
      total: [
        ...addNumericStages,
        ...(Object.keys(percentMatch).length > 0 ? [{ $match: percentMatch }] : []),
        { $count: "count" },
      ],
    },
  });

  return facetPipeline;
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const body = await request.json();

    await connectToMongo();

    const pipeline = buildFacetPipeline(body);
    const [res] = await propertiesCollection.aggregate(pipeline).toArray();
    const items = res?.items || [];
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
    const items = res?.items || [];
    const total = (res?.total?.[0]?.count as number) || 0;

    return NextResponse.json({ items, total, page, limit });
  } catch (e) {
    console.error("/api/properties GET error:", e);
    return NextResponse.json({ error: "Failed to fetch properties" }, { status: 500 });
  }
}
