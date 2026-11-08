import { cookies } from "next/headers";
import { auth } from "@/auth";
import { CHALLENGE_COOKIE, HANDOFF_SECONDS, hash, isToken, newCode, sessionCookies } from "@/lib/app-handoff";
import { encrypt } from "@/lib/crypto";
import { sql } from "@/lib/db";

const page = (body: string) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Almanac</title>
<body style="font-family:system-ui;padding:2rem;text-align:center">${body}</body>`,
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );

// GET /api/android/handoff: the browser, now signed in, passes the session to the Android app with a one-time code.
export async function GET() {
  const jar = await cookies();
  const challenge = jar.get(CHALLENGE_COOKIE)?.value;
  const session = sessionCookies(jar.getAll());
  if (!(await auth())?.user?.id || !isToken(challenge) || !session.length) {
    return page("<h1>Sign-in didn't finish</h1><p>Go back to the Almanac app and tap Continue with Google again.</p>");
  }
  jar.delete({ name: CHALLENGE_COOKIE, path: "/api/android" });

  const code = newCode();
  await sql`delete from app_handoffs where expires_at < now()`;
  await sql`
    insert into app_handoffs (code_hash, challenge, cookies_enc, expires_at)
    values (${hash(code)}, ${challenge}, ${encrypt(JSON.stringify(session))}, now() + make_interval(secs => ${HANDOFF_SECONDS}))`;

  // An intent link: Chrome opens only the Almanac app with it, never another app that claims "almanac://".
  const link = `intent://signed-in?code=${code}#Intent;scheme=almanac;package=app.almanac.calendar;end`;
  return page(`<h1>Signed in</h1><p>Returning to the Almanac app…</p>
<p><a href="${link}" style="display:inline-block;margin-top:1rem;padding:.75rem 1.5rem;border-radius:999px;background:#111;color:#fff;text-decoration:none">Open Almanac</a></p>
<script>location.href=${JSON.stringify(link)}</script>`);
}
