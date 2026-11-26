import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { sql } from "@/lib/db";
import { cookies } from "next/headers";
import { encrypt } from "@/lib/crypto";
import { attachAccount, linkDone, LINK_COOKIE, readTicket } from "@/lib/accounts";

// Scopes: sign-in, list calendars, read/write events, read/write Google Tasks (the tasks Google Calendar shows; see
// calendar.ts), and read Gmail ("Read my email": meetings, calls and deadlines in new mail). All on one Google screen,
// at sign-in and when adding another account; Google lets people untick Gmail or Tasks there, and then Settings
// offers Allow later. Nothing else from the Google account.
// Free/busy is computed from the events we already read, so the separate free/busy scope isn't needed.
// Read only. Accounts that allowed gmail.modify for the old inbox still read with it; MAIL_READ matches either, in SQL like.
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const MAIL_READ = "%/auth/gmail.%";
const scope = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/tasks",
  GMAIL_SCOPE,
].join(" ");
export const withGmail = { scope }; // shortcut: the same as the default now; kept for Settings' Connect Gmail and the app

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      // offline + consent makes Google return a refresh token, so reminders work while you're away.
      // include_granted_scopes keeps Gmail (if it was allowed) when signing in again later.
      authorization: { params: { scope, access_type: "offline", prompt: "consent", include_granted_scopes: "true" } },
    }),
  ],
  pages: { signIn: "/", error: "/" },
  callbacks: {
    // Adding another Google account (see accounts.ts): attach it and go back, without signing in with it.
    async signIn({ account, profile }) {
      const jar = await cookies();
      const ticket = readTicket(jar.get(LINK_COOKIE)?.value);
      if (!ticket) return true;
      jar.delete(LINK_COOKIE);
      if (!account || !profile?.sub || !profile.email) return linkDone(ticket, "error");
      return linkDone(ticket, await attachAccount(ticket.uid, profile.sub, profile.email, account));
    },
    // The session cookie only holds our user id. Google tokens live encrypted in the database.
    async jwt({ token, account, profile }) {
      if (account && profile?.sub && profile.email) {
        // An account attached to someone's Almanac opens theirs; otherwise this is a main account, with its own user.
        const [attached] = await sql<{ user_id: string }[]>`
          select user_id from google_accounts where google_sub = ${profile.sub} and not is_main`;
        const userId =
          attached?.user_id ??
          (
            await sql<{ id: string }[]>`
              -- New here and Gmail allowed on the sign-in screen: "Read my email" starts on (Settings can turn it off).
              insert into users (google_sub, email, name, mail_on)
              values (${profile.sub}, ${profile.email}, ${profile.name ?? null}, ${!!account.scope?.includes(GMAIL_SCOPE)})
              on conflict (google_sub) do update set email = excluded.email, name = excluded.name
              returning id`
          )[0].id;
        await sql`
          insert into google_accounts (user_id, google_sub, email, is_main, refresh_token_enc, access_token_enc, access_expires_at, scope)
          values (
            ${userId},
            ${profile.sub},
            ${profile.email},
            ${!attached},
            ${account.refresh_token ? encrypt(account.refresh_token) : null},
            ${account.access_token ? encrypt(account.access_token) : null},
            to_timestamp(${account.expires_at ?? 0}),
            ${account.scope ?? null}
          )
          on conflict (google_sub) do update set
            email = excluded.email,
            refresh_token_enc = coalesce(excluded.refresh_token_enc, google_accounts.refresh_token_enc),
            access_token_enc = excluded.access_token_enc,
            access_expires_at = excluded.access_expires_at,
            scope = excluded.scope,
            broken_at = null,
            updated_at = now()`;
        token.uid = userId;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.uid as string;
      return session;
    },
  },
});
