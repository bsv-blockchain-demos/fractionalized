import { toOutpoint, toTxid, parseOutpoint } from "../src/utils/outpoints";

describe("utils/outpoints", () => {
  test("toOutpoint uses provided vout when input is a bare txid", () => {
    expect(toOutpoint("abcd", 0)).toBe("abcd.0");
    expect(toOutpoint("abcd", 2)).toBe("abcd.2");
  });

  test("toOutpoint preserves existing vout when input is already an outpoint", () => {
    expect(toOutpoint("abcd.0", 9)).toBe("abcd.0");
    expect(toOutpoint("ef01.7", 1)).toBe("ef01.7");
  });

  test("toTxid extracts the raw txid from txid or outpoint", () => {
    expect(toTxid("abcd")).toBe("abcd");
    expect(toTxid("abcd.0")).toBe("abcd");
    expect(toTxid("abcd.12")).toBe("abcd");
  });

  test("parseOutpoint extracts txid and vout (defaults to 0)", () => {
    expect(parseOutpoint("abcd")).toEqual({ txid: "abcd", vout: 0 });
    expect(parseOutpoint("abcd.0")).toEqual({ txid: "abcd", vout: 0 });
    expect(parseOutpoint("abcd.12")).toEqual({ txid: "abcd", vout: 12 });
  });
});
