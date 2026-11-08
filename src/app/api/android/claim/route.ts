import { cookies } from "next/headers";
import { challengeMatches, isToken, hash } from "@/lib/app-handoff";
import { decrypt } from "@/lib/crypto";
import { sql } from "@/lib/db";

const SESSION_DAYS = 30; // Auth.js's default session length

// POST /api/android/claim {code, verifier}: the Android app swaps the one-time code for the session. The code
// is gone after the first try, right or wrong.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!isToken(body?.code) || !isToken(body?.verifier)) return Response.json({ error: "Invalid request" }, { status: 400 });

  const [row] = await sql<{ challenge: string; cookies_enc: string }[]>`
    delete from app_handoffs where code_hash = ${hash(body.code)} and expires_at > now() returning challenge, cookies_enc`;
  if (!row || !challengeMatches(row.challenge, body.verifier)) return Response.json({ error: "expired" }, { status: 400 });

  const jar = await cookies();
  for (const { name, value } of JSON.parse(decrypt(row.cookies_enc)) as { name: string; value: string }[]) {
    jar.set(name, value, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86_400 });
  }
  return Response.json({ ok: true });
}
