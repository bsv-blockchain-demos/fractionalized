import { escapeRegex } from "../utils/validation";

export const PROPERTY_STATUSES = ["upcoming", "open", "funded", "sold"] as const;

// Helper to build aggregation pipeline based on filters and sorting, returning a $facet
export function buildFacetPipeline(body: any) {
  const {
    page = 1,
    limit = 20,
    filters = {},
    sortBy = "price_desc",
    activeStatus = "all",
  } = body || {};

  const match: Record<string, any> = {};

  // Status handling: only ever accept known string statuses (no operator injection).
  if (typeof activeStatus === "string" && activeStatus !== "all" &&
      (PROPERTY_STATUSES as readonly string[]).includes(activeStatus)) {
    match.status = activeStatus;
  }
  if (Array.isArray(filters.statuses)) {
    const safe = filters.statuses.filter(
      (s: unknown): s is string => typeof s === "string" && (PROPERTY_STATUSES as readonly string[]).includes(s),
    );
    if (safe.length > 0) {
      match.status = match.status ? { $in: safe.filter((s: string) => s === match.status) } : { $in: safe };
    }
  }

  // Numeric ranges (direct numeric fields)
  if (filters.priceMin != null) match.priceUSD = { ...(match.priceUSD || {}), $gte: Number(filters.priceMin) };
  if (filters.priceMax != null) match.priceUSD = { ...(match.priceUSD || {}), $lte: Number(filters.priceMax) };

  if (filters.investorsMin != null) match.investors = { ...(match.investors || {}), $gte: Number(filters.investorsMin) };
  if (filters.investorsMax != null) match.investors = { ...(match.investors || {}), $lte: Number(filters.investorsMax) };

  // Simple text query
  const q: string = (typeof filters.query === "string" ? filters.query : "").trim();
  if (q) {
    const safeQ = escapeRegex(q);
    match.$or = [
      { title: { $regex: safeQ, $options: "i" } },
      { location: { $regex: safeQ, $options: "i" } },
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
  const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
  const skip = Math.max(0, (Number(page) - 1) * safeLimit);

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
        { $limit: safeLimit },
        // Lookup shares to calculate available percent
        {
          $lookup: {
            from: "shares",
            localField: "_id",
            foreignField: "propertyId",
            as: "shares",
          },
        },
        {
          $addFields: {
            totalSold: { $sum: "$shares.amount" },
            // Use stored remainingPercent if available, otherwise calculate from shares
            availablePercent: {
              $cond: [
                { $ne: ["$sell.remainingPercent", null] },
                "$sell.remainingPercent",
                {
                  $cond: [
                    { $ne: ["$sell.percentToSell", null] },
                    { $subtract: ["$sell.percentToSell", { $sum: "$shares.amount" }] },
                    null,
                  ],
                },
              ],
            },
            // Calculate unique investors count from shares
            investors: {
              $cond: [
                { $gt: [{ $size: "$shares" }, 0] },
                { $size: { $setUnion: ["$shares.investorId", []] } },
                0,
              ],
            },
          },
        },
        { $set: { _id: { $toString: "$_id" } } },
        { $project: { grossYieldNum: 0, netYieldNum: 0, annualisedReturnNum: 0, shares: 0 } },
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
