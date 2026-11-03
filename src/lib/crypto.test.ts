import { randomBytes } from "node:crypto";
import { beforeAll, expect, test } from "vitest";
import { decrypt, encrypt } from "./crypto";

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

test("round-trips and never stores the plain token", () => {
  const blob = encrypt("ya29.secret-token");
  expect(blob).not.toContain("secret");
  expect(decrypt(blob)).toBe("ya29.secret-token");
});

test("rejects a tampered token", () => {
  const [iv, tag, data] = encrypt("hello").split(".");
  const flipped = Buffer.from(data, "base64");
  flipped[0] ^= 1;
  expect(() => decrypt([iv, tag, flipped.toString("base64")].join("."))).toThrow();
});
