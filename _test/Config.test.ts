import {
  getJwtSecret,
  getServerPrivateKey,
  getWalletStorageUrl,
  getMongoUri,
  getMinBalance,
} from "../src/lib/config";

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

describe("getServerPrivateKey", () => {
  const original = process.env.SERVER_PRIVATE_KEY;
  afterEach(() => { process.env.SERVER_PRIVATE_KEY = original; });

  test("returns the value when set", () => {
    process.env.SERVER_PRIVATE_KEY = "some-private-key";
    expect(getServerPrivateKey()).toBe("some-private-key");
  });
  test("throws when unset", () => {
    delete process.env.SERVER_PRIVATE_KEY;
    expect(() => getServerPrivateKey()).toThrow();
  });
  test("throws when empty", () => {
    process.env.SERVER_PRIVATE_KEY = "";
    expect(() => getServerPrivateKey()).toThrow();
  });
});

describe("getWalletStorageUrl", () => {
  const original = process.env.WALLET_STORAGE_URL;
  afterEach(() => { process.env.WALLET_STORAGE_URL = original; });

  test("returns the value when set", () => {
    process.env.WALLET_STORAGE_URL = "https://storage.example.com";
    expect(getWalletStorageUrl()).toBe("https://storage.example.com");
  });
  test("throws when unset", () => {
    delete process.env.WALLET_STORAGE_URL;
    expect(() => getWalletStorageUrl()).toThrow();
  });
  test("throws when empty", () => {
    process.env.WALLET_STORAGE_URL = "";
    expect(() => getWalletStorageUrl()).toThrow();
  });
});

describe("getMongoUri", () => {
  const original = process.env.MONGODB_URI;
  afterEach(() => { process.env.MONGODB_URI = original; });

  test("returns the value when set", () => {
    process.env.MONGODB_URI = "mongodb://localhost:27017/test";
    expect(getMongoUri()).toBe("mongodb://localhost:27017/test");
  });
  test("throws when unset", () => {
    delete process.env.MONGODB_URI;
    expect(() => getMongoUri()).toThrow();
  });
  test("throws when empty", () => {
    process.env.MONGODB_URI = "";
    expect(() => getMongoUri()).toThrow();
  });
});

describe("getMinBalance", () => {
  const original = process.env.MIN_BALANCE;
  afterEach(() => { process.env.MIN_BALANCE = original; });

  test("returns a number when set to a numeric string", () => {
    process.env.MIN_BALANCE = "1000";
    expect(getMinBalance()).toBe(1000);
  });
  test("throws when unset", () => {
    delete process.env.MIN_BALANCE;
    expect(() => getMinBalance()).toThrow();
  });
  test("throws when non-numeric", () => {
    process.env.MIN_BALANCE = "not-a-number";
    expect(() => getMinBalance()).toThrow();
  });
});
