import { createHash, randomBytes } from "node:crypto";

// Android app sign-in, in three hops:
// 1. The app makes a secret (verifier) and opens /api/android/sign-in?c=<challenge> in the phone's browser, where
//    challenge = sha256(verifier). Google refuses sign-in inside apps, so it has to happen in the browser.
// 2. After Google, /api/android/handoff saves the browser's session for 2 minutes under a one-time code and hands
//    the code to the app (a link only the Almanac app opens).
// 3. The app posts code + verifier to /api/android/claim and gets the session. A stolen code is useless without
//    the verifier, which never leaves the app.

export const HANDOFF_SECONDS = 120;
export const CHALLENGE_COOKIE = "almanac-app-challenge";
const TOKEN = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url
// Auth.js's session cookie, split into .0, .1, ... when it's long; "__Secure-" on https.
const SESSION_COOKIE = /^(__Secure-)?authjs\.session-token(\.\d+)?$/;

export const isToken = (v: unknown): v is string => typeof v === "string" && TOKEN.test(v);
export const newCode = () => randomBytes(32).toString("base64url");
export const hash = (v: string) => createHash("sha256").update(v).digest("base64url");
export const challengeMatches = (challenge: string, verifier: string) => hash(verifier) === challenge;
export const sessionCookies = (all: { name: string; value: string }[]) =>
  all.filter((c) => SESSION_COOKIE.test(c.name)).map(({ name, value }) => ({ name, value }));
