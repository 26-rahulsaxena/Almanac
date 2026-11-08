import { describe, expect, it } from "vitest";
import { challengeMatches, hash, isToken, newCode, sessionCookies } from "./app-handoff";

describe("app sign-in handoff", () => {
  it("only the verifier behind a challenge claims it", () => {
    const verifier = newCode();
    expect(challengeMatches(hash(verifier), verifier)).toBe(true);
    expect(challengeMatches(hash(verifier), newCode())).toBe(false);
  });

  it("accepts only 32-byte codes", () => {
    expect(isToken(newCode())).toBe(true);
    expect(isToken(hash("x"))).toBe(true);
    for (const bad of ["", "short", newCode() + "a", "a".repeat(42) + "=", null, 7]) expect(isToken(bad)).toBe(false);
  });

  it("copies only the session cookie, including its split parts", () => {
    const got = sessionCookies([
      { name: "__Secure-authjs.session-token.0", value: "a" },
      { name: "__Secure-authjs.session-token.1", value: "b" },
      { name: "authjs.session-token", value: "c" },
      { name: "authjs.csrf-token", value: "x" },
      { name: "alertsBannerUntil", value: "y" },
    ]);
    expect(got.map((c) => c.name)).toEqual(["__Secure-authjs.session-token.0", "__Secure-authjs.session-token.1", "authjs.session-token"]);
  });
});
