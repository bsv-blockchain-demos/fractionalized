import { buildFacetPipeline } from "../src/lib/propertiesPipeline";

function matchStage(pipeline: any[]) {
  return pipeline.find((s) => s.$match)?.$match;
}
function itemsLimit(pipeline: any[]) {
  const facet = pipeline.find((s) => s.$facet)?.$facet;
  return facet?.items?.find((st: any) => st.$limit)?.$limit;
}

test("rejects an object activeStatus (no operator injection)", () => {
  const p = buildFacetPipeline({ activeStatus: { $ne: null } });
  const m = matchStage(p);
  expect(m?.status).toBeUndefined();
});

test("accepts a known status", () => {
  const p = buildFacetPipeline({ activeStatus: "open" });
  expect(matchStage(p)?.status).toBe("open");
});

test("escapes regex metacharacters in query", () => {
  const p = buildFacetPipeline({ filters: { query: ".*" } });
  expect(matchStage(p).$or[0].title.$regex).toBe("\\.\\*");
});

test("clamps limit to 100", () => {
  expect(itemsLimit(buildFacetPipeline({ limit: 100000 }))).toBeLessThanOrEqual(100);
});
