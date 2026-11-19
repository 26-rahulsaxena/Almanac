import { decrypt, encrypt } from "./crypto";
import { sql } from "./db";

// Adding another Google account to an Almanac (Settings → Account → Add):
// 1. linkUrl() makes /api/link?t=<ticket>: who's adding (their Almanac user), from where (website or Android app),
//    until when. Encrypted, so it can't be made up or changed.
// 2. /api/link keeps the ticket in a cookie and opens Google's account chooser.
// 3. Back from Google, the signIn callback (auth.ts) sees the cookie and attaches that account instead of signing in
//    with it, then redirects to linkDone(). Who's signed in never changes.
export const LINK_COOKIE = "almanac-link";
export const LINK_SECONDS = 10 * 60; // time to get through Google's screens

// gmail: also ask to read Gmail (Settings → Planning → Read my email → Allow).
type Ticket = { uid: string; app: boolean; gmail?: boolean; exp: number };
export type LinkResult = "added" | "moved" | "again" | "main" | "error";

export const makeTicket = (uid: string, app: boolean, gmail = false) => encrypt(JSON.stringify({ uid, app, gmail, exp: Date.now() + LINK_SECONDS * 1000 }));

export function readTicket(t: string | undefined | null): Ticket | null {
  if (!t) return null;
  try {
    const v = JSON.parse(decrypt(t)) as Ticket;
    return typeof v.uid === "string" && typeof v.app === "boolean" && v.exp > Date.now() ? v : null;
  } catch {
    return null;
  }
}

// Where the browser lands once it's done: the calendar with Settings → Account open, or in the phone's browser a page
// that says to go back to the app (which reloads when that browser tab closes).
export const linkDone = (t: Ticket, result: LinkResult) => (t.app ? `/api/link?done=${result}` : `/?account=${result}`);

type Login = { refresh_token?: string; access_token?: string; expires_at?: number; scope?: string };

// Attaches a Google account the person just signed in to. Already somebody's main account (its own Almanac, from
// signing in with it before): it moves here, as they've just shown it's theirs. Its old Almanac's to-dos and settings
// stay in the database, but signing in with it opens this one from now on.
export async function attachAccount(uid: string, sub: string, email: string, login: Login): Promise<LinkResult> {
  const [had] = await sql<{ user_id: string; is_main: boolean }[]>`select user_id, is_main from google_accounts where google_sub = ${sub}`;
  if (had?.user_id === uid && had.is_main) return "main";
  if (!had && !login.refresh_token) return "error"; // Google always sends one with prompt=consent; without it reminders couldn't work
  await sql`
    insert into google_accounts (user_id, google_sub, email, is_main, refresh_token_enc, access_token_enc, access_expires_at, scope)
    values (
      ${uid}, ${sub}, ${email}, false,
      ${login.refresh_token ? encrypt(login.refresh_token) : null},
      ${login.access_token ? encrypt(login.access_token) : null},
      to_timestamp(${login.expires_at ?? 0}),
      ${login.scope ?? null}
    )
    on conflict (google_sub) do update set
      user_id = excluded.user_id,
      is_main = false,
      email = excluded.email,
      refresh_token_enc = coalesce(excluded.refresh_token_enc, google_accounts.refresh_token_enc),
      access_token_enc = excluded.access_token_enc,
      access_expires_at = excluded.access_expires_at,
      scope = excluded.scope,
      broken_at = null,
      updated_at = now()`;
  return !had ? "added" : had.user_id === uid ? "again" : "moved";
}

// gmail: Almanac may read its Gmail. send: also reply, archive and trash (accounts from before only allowed reading).
// active: switched on in the ☰ menu (Home, Calendar, Mail and the assistant use it).
export type Account = { id: string; email: string; main: boolean; broken: boolean; gmail: boolean; send: boolean; active: boolean };

export const listAccounts = (uid: string) =>
  sql<Account[]>`
    select id, email, is_main as main, broken_at is not null as broken, scope like '%/auth/gmail.%' as gmail, scope like '%/gmail.modify%' as send,
      (select cardinality(active_accounts) = 0 or google_accounts.id = any(active_accounts) from users where users.id = google_accounts.user_id) as active
    from google_accounts
    where user_id = ${uid} order by is_main desc, created_at`;
