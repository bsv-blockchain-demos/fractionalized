import { toPublicProperty } from "../src/lib/serializers";

const raw: any = {
  _id: { toString: () => "abc123" },
  title: "Villa", location: "Dubai", priceUSD: 1000, status: "open",
  annualisedReturn: "8%", currentValuationUSD: 2000, grossYield: "9%", netYield: "7%",
  investmentBreakdown: { purchaseCost: 1, transactionCost: 2, runningCost: 3 },
  features: { beds: 3 }, images: ["a.png"], sell: { percentToSell: 50, remainingPercent: 20 },
  investors: 4,
  // txids: tokenTxid is public/safe; the rest are sensitive — must NOT appear:
  txids: { tokenTxid: "t", currentOutpoint: "co.0", paymentTxid: "pt.1", originalMintTxid: "om.0", mintTxid: "mt.0" },
  currentDerivation: { beef: "x" }, paymentDerivation: { keyId: "k" },
  proofOfOwnership: "BASE64PDF", seller: "02deadbeef",
};

test("includes whitelisted fields", () => {
  const out = toPublicProperty(raw, { availablePercent: 20, totalSold: 30, investors: 4 });
  expect(out._id).toBe("abc123");
  expect(out.title).toBe("Villa");
  expect(out.priceUSD).toBe(1000);
  expect(out.sell).toEqual({ percentToSell: 50, remainingPercent: 20 });
  expect(out.availablePercent).toBe(20);
  expect(out.totalSold).toBe(30);
  expect(out.investors).toBe(4);
  expect(out.txids).toEqual({ tokenTxid: "t" });
});

test("NEVER includes sensitive fields", () => {
  const out: any = toPublicProperty(raw);
  for (const f of ["currentDerivation", "paymentDerivation", "proofOfOwnership", "seller"]) {
    expect(out[f]).toBeUndefined();
  }
  expect(out.txids?.currentOutpoint).toBeUndefined();
  expect(out.txids?.paymentTxid).toBeUndefined();
  expect(out.txids?.originalMintTxid).toBeUndefined();
  expect(out.txids?.mintTxid).toBeUndefined();
});
