import { sql } from "./db";
import { decrypt, encrypt } from "./crypto";

// Google no longer accepts our saved login (revoked, or the 7-day testing-mode expiry). User must sign in again.
export class ReauthError extends Error {}

export class GoogleError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Google ${status}: ${body}`);
  }
}

type Token = { token: string; expiresAt: number };
// A connected Google account. Only the main one losing its login signs you out; an added one just needs reconnecting.
export type GoogleAccount = { id: string; main: boolean };

// Google stopped accepting an account's saved login. The main account: sign in again. An added account: its calendars
// drop out (callers treat this like any failed Google call) and Settings → Account offers Reconnect.
async function loginLost(a: GoogleAccount) {
  tokens.delete(a.id);
  if (a.main) return new ReauthError();
  await sql`update google_accounts set broken_at = coalesce(broken_at, now()) where id = ${a.id}`;
  return new GoogleError(401, "Reconnect this Google account in Settings → Account.");
}

async function freshToken(account: GoogleAccount): Promise<Token> {
  const accountId = account.id;
  const [t] = await sql<{ refresh_token_enc: string; access_token_enc: string | null; access_expires_at: Date | null }[]>`
    select refresh_token_enc, access_token_enc, access_expires_at from google_accounts where id = ${accountId}`;
  if (!t) throw account.main ? new ReauthError() : new GoogleError(401, "This Google account was removed.");
  if (t.access_token_enc && t.access_expires_at && t.access_expires_at.getTime() > Date.now() + 60_000) {
    return { token: decrypt(t.access_token_enc), expiresAt: t.access_expires_at.getTime() };
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    signal: AbortSignal.timeout(20_000),
    body: new URLSearchParams({
      client_id: process.env.AUTH_GOOGLE_ID!,
      client_secret: process.env.AUTH_GOOGLE_SECRET!,
      refresh_token: decrypt(t.refresh_token_enc),
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw data.error === "invalid_grant" ? await loginLost(account) : new Error(`Token refresh failed: ${data.error}`);
  await sql`
    update google_accounts
    set access_token_enc = ${encrypt(data.access_token)},
        access_expires_at = now() + make_interval(secs => ${data.expires_in}),
        updated_at = now()
    where id = ${accountId}`;
  return { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
}

// One access token per connected account, reused in server memory until a minute before expiry,
// so parallel calendar calls don't each hit the database or refresh it.
const tokens = new Map<string, Promise<Token>>();

async function accessToken(account: GoogleAccount) {
  const cached = await tokens.get(account.id)?.catch(() => null);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const p = freshToken(account);
  tokens.set(account.id, p);
  try {
    return (await p).token;
  } catch (err) {
    tokens.delete(account.id);
    throw err;
  }
}

// Which of the user's Google accounts a call goes through: the one the calendar comes from, otherwise the main one
// (for Gmail, the calendar list, and Google's "primary" shortcut, which is the main account's own calendar).
async function accountFor(userId: string, calendarId?: string): Promise<GoogleAccount> {
  const [a] = await sql<GoogleAccount[]>`
    select a.id, a.is_main as main from google_accounts a
    left join account_calendars c on c.account_id = a.id and c.user_id = ${userId} and c.calendar_id = ${calendarId ?? null}
    where a.user_id = ${userId} and (c.calendar_id is not null or a.is_main)
    order by c.calendar_id is null
    limit 1`;
  if (!a) throw new ReauthError();
  return a;
}

// Remembers which account each calendar comes from, for accountFor (a write only when one changed account).
export async function rememberCalendars(userId: string, cals: { id: string; accountId: string }[]) {
  await sql`
    insert into account_calendars (user_id, calendar_id, account_id)
    select ${userId}, c, a::uuid from unnest(${cals.map((c) => c.id)}::text[], ${cals.map((c) => c.accountId)}::text[]) as t(c, a)
    on conflict (user_id, calendar_id) do update set account_id = excluded.account_id
      where account_calendars.account_id <> excluded.account_id`;
}

// The calendar a Calendar API path is about ("/calendars/<id>/events…"), which decides the account it goes through.
export function calendarIn(path: string) {
  const m = /^\/calendars\/([^/?]+)/.exec(path);
  return m ? decodeURIComponent(m[1]) : undefined;
}

// Calls the Google Calendar REST API as this user, through the account the calendar in the path comes from.
export const gcal = <T>(userId: string, path: string, init?: RequestInit) =>
  google<T>(userId, `https://www.googleapis.com/calendar/v3${path}`, init, calendarIn(path));

// Calls the Google Calendar REST API as one particular account (e.g. to list that account's calendars).
export const gcalAs = <T>(account: GoogleAccount, path: string) => call<T>(account, `https://www.googleapis.com/calendar/v3${path}`);

// Calls a Google REST API as this user, through the account that calendar comes from (default: the main account).
export async function google<T>(userId: string, url: string, init?: RequestInit, calendarId?: string): Promise<T> {
  return call<T>(await accountFor(userId, calendarId), url, init);
}

async function call<T>(account: GoogleAccount, url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20_000), // never hang on a dead connection (e.g. after the computer slept)
    ...init,
    cache: "no-store",
    headers: { ...init?.headers, Authorization: `Bearer ${await accessToken(account)}` },
  });
  if (res.status === 401) throw await loginLost(account);
  if (!res.ok) {
    const body = await res.text();
    // A permission allowed since (e.g. Gmail): the remembered token predates it, so read the new one next time.
    if (res.status === 403 && body.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT")) tokens.delete(account.id);
    throw new GoogleError(res.status, body);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
export { call as googleAs };
