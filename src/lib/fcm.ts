import { createSign } from "node:crypto";

// Firebase Cloud Messaging (HTTP v1): how reminders reach the Android app. FIREBASE_SERVICE_ACCOUNT holds the
// service account's JSON key, from Firebase → Project settings → Service accounts.
type Account = { project_id: string; client_email: string; private_key: string };
let account: Account | null | undefined;
let access: { token: string; until: number } | null = null;

function serviceAccount() {
  if (account === undefined) {
    try {
      account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT ?? "") as Account;
    } catch {
      account = null;
    }
  }
  return account;
}

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

// A one-hour Google access token, made by signing a request with the service account's key.
async function accessToken(sa: Account) {
  if (access && access.until > Date.now() + 60_000) return access.token;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const jwt = `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url")}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!res.ok) throw new Error(`Firebase sign-in failed: ${res.status}`);
  const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
  access = { token: access_token, until: Date.now() + expires_in * 1000 };
  return access_token;
}

// Sends the payload to one app install. "gone": the app was uninstalled or its token replaced.
// It's a data message, so the app itself decides how to show it (the start alarm rings full screen).
export async function sendFcm(token: string, payload: object): Promise<"ok" | "gone" | "error"> {
  const sa = serviceAccount();
  if (!sa) {
    console.error("Push failed: FIREBASE_SERVICE_ACCOUNT is missing or not valid JSON");
    return "error";
  }
  try {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken(sa)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { token, data: { json: JSON.stringify(payload) }, android: { priority: "HIGH", ttl: "600s" } } }),
    });
    if (res.ok) return "ok";
    if (res.status === 404) return "gone";
    console.error("Push failed (app)", res.status, (await res.text()).slice(0, 300));
    return "error";
  } catch (err) {
    console.error("Push failed (app)", err);
    return "error";
  }
}
