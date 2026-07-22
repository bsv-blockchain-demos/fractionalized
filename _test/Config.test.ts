import { getJwtSecret } from "../src/lib/config";

describe("getJwtSecret", () => {
  const original = process.env.JWT_SECRET;
  afterEach(() => { process.env.JWT_SECRET = original; });

  test("returns a valid secret", () => {
    process.env.JWT_SECRET = "x".repeat(32);
    expect(getJwtSecret()).toHaveLength(32);
  });
  test("throws when unset", () => {
    delete process.env.JWT_SECRET;
    expect(() => getJwtSecret()).toThrow();
  });
  test("throws when too short", () => {
    process.env.JWT_SECRET = "short";
    expect(() => getJwtSecret()).toThrow();
  });
});
