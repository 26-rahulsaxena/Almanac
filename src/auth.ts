import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { sql } from "@/lib/db";
import { encrypt } from "@/lib/crypto";

// Minimum scopes: sign-in, list calendars, read/write events, and for the sheet sync only the files you pick
// in Google's file picker or that Almanac creates (drive.file), never the rest of your Drive.
// Free/busy is computed from the events we already read, so the separate free/busy scope isn't needed.
export const SHEETS_SCOPE = "https://www.googleapis.com/auth/drive.file";
const scope = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  SHEETS_SCOPE,
].join(" ");

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      // offline + consent makes Google return a refresh token, so reminders work while you're away.
      authorization: { params: { scope, access_type: "offline", prompt: "consent" } },
    }),
  ],
  pages: { signIn: "/", error: "/" },
  callbacks: {
    // The session cookie only holds our user id. Google tokens live encrypted in the database.
    async jwt({ token, account, profile }) {
      if (account && profile?.sub && profile.email) {
        const [user] = await sql<{ id: string }[]>`
          insert into users (google_sub, email, name)
          values (${profile.sub}, ${profile.email}, ${profile.name ?? null})
          on conflict (google_sub) do update set email = excluded.email, name = excluded.name
          returning id`;
        await sql`
          insert into google_tokens (user_id, refresh_token_enc, access_token_enc, access_expires_at, scope)
          values (
            ${user.id},
            ${account.refresh_token ? encrypt(account.refresh_token) : null},
            ${account.access_token ? encrypt(account.access_token) : null},
            to_timestamp(${account.expires_at ?? 0}),
            ${account.scope ?? null}
          )
          on conflict (user_id) do update set
            refresh_token_enc = coalesce(excluded.refresh_token_enc, google_tokens.refresh_token_enc),
            access_token_enc = excluded.access_token_enc,
            access_expires_at = excluded.access_expires_at,
            scope = excluded.scope,
            updated_at = now()`;
        token.uid = user.id;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.uid as string;
      return session;
    },
  },
});
