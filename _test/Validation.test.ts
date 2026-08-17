import {
  ValidationError, asString, asNumberInRange, asObjectId, asEnum, escapeRegex, requireFields,
} from "@server/lib/validation";

describe("validation helpers", () => {
  test("asString accepts strings, rejects non-strings and over-length", () => {
    expect(asString("ok", "f")).toBe("ok");
    expect(() => asString(5, "f")).toThrow(ValidationError);
    expect(() => asString("toolong", "f", { maxLength: 3 })).toThrow(ValidationError);
  });
  test("asNumberInRange enforces finite + range", () => {
    expect(asNumberInRange(5, "f", 0, 10)).toBe(5);
    expect(() => asNumberInRange(NaN, "f", 0, 10)).toThrow(ValidationError);
    expect(() => asNumberInRange(11, "f", 0, 10)).toThrow(ValidationError);
  });
  test("asObjectId validates 24-hex ids", () => {
    expect(asObjectId("507f1f77bcf86cd799439011", "id").toString()).toBe("507f1f77bcf86cd799439011");
    expect(() => asObjectId("nope", "id")).toThrow(ValidationError);
    expect(() => asObjectId({ $ne: null }, "id")).toThrow(ValidationError);
  });
  test("asEnum rejects values outside the allowlist", () => {
    const allowed = ["open", "sold"] as const;
    expect(asEnum("open", "s", allowed)).toBe("open");
    expect(() => asEnum("hacked", "s", allowed)).toThrow(ValidationError);
    expect(() => asEnum({ $ne: null }, "s", allowed)).toThrow(ValidationError);
  });
  test("escapeRegex neutralizes metacharacters", () => {
    expect(escapeRegex(".*+?^${}()|[]\\")).toBe("\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\");
  });
  test("requireFields lists missing keys", () => {
    expect(() => requireFields({ a: 1, b: null }, ["a", "b"])).toThrow(/b/);
    expect(() => requireFields({ a: 1 }, ["a"])).not.toThrow();
  });
});
