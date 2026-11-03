import { sql } from "./db";
import { decrypt, encrypt } from "./crypto";

// Google no longer accepts our saved login (revoked, or the 7-day testing-mode expiry). User must sign in again.
export class ReauthError extends Error {}

type Token = { token: string; expiresAt: number };

async function freshToken(userId: string): Promise<Token> {
  const [t] = await sql<{ refresh_token_enc: string; access_token_enc: string | null; access_expires_at: Date | null }[]>`
    select refresh_token_enc, access_token_enc, access_expires_at from google_tokens where user_id = ${userId}`;
  if (!t) throw new ReauthError();
  if (t.access_token_enc && t.access_expires_at && t.access_expires_at.getTime() > Date.now() + 60_000) {
    return { token: decrypt(t.access_token_enc), expiresAt: t.access_expires_at.getTime() };
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: process.env.AUTH_GOOGLE_ID!,
      client_secret: process.env.AUTH_GOOGLE_SECRET!,
      refresh_token: decrypt(t.refresh_token_enc),
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw data.error === "invalid_grant" ? new ReauthError() : new Error(`Token refresh failed: ${data.error}`);
  await sql`
    update google_tokens
    set access_token_enc = ${encrypt(data.access_token)},
        access_expires_at = now() + make_interval(secs => ${data.expires_in}),
        updated_at = now()
    where user_id = ${userId}`;
  return { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
}

// One access token per user, reused in server memory until a minute before expiry,
// so parallel calendar calls don't each hit the database or refresh it.
const tokens = new Map<string, Promise<Token>>();

async function accessToken(userId: string) {
  const cached = await tokens.get(userId)?.catch(() => null);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const p = freshToken(userId);
  tokens.set(userId, p);
  try {
    return (await p).token;
  } catch (err) {
    tokens.delete(userId);
    throw err;
  }
}

// Calls the Google Calendar REST API as this user.
export async function gcal<T>(userId: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    cache: "no-store",
    headers: { ...init?.headers, Authorization: `Bearer ${await accessToken(userId)}` },
  });
  if (res.status === 401) {
    tokens.delete(userId);
    throw new ReauthError();
  }
  if (!res.ok) throw new Error(`Google Calendar ${res.status}: ${await res.text()}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}
