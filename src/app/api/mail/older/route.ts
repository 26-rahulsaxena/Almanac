import { auth } from "@/auth";
import { hasAi } from "@/lib/ai";
import { ReauthError } from "@/lib/google";
import { readOlder } from "@/lib/mail";
import { me } from "@/lib/planner";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = (error: string, status = 400) => Response.json({ error }, { status });

// POST /api/mail/older {account?, page?} → { found, next } — "Read older emails": one page of the last 30 days of
// mail. Send back the `next` it gives until it's null. found: how many meetings, calls and deadlines this page added.
export async function POST(req: Request) {
  const u = await me((await auth())?.user?.id);
  if (!u) return fail("signin", 401);
  if (!hasAi()) return fail("Reading email isn't set up on this server.", 503);
  const b = await req.json().catch(() => ({}));
  const at = b?.account === undefined ? undefined : { account: String(b.account), page: b.page === undefined ? undefined : String(b.page) };
  if (at && (!UUID.test(at.account) || (at.page ?? "").length > 200)) return fail("Invalid request");
  try {
    const r = await readOlder(u, at);
    if (!r) return fail("gmail", 409); // no account allows reading Gmail
    return Response.json(r);
  } catch (err) {
    if (err instanceof ReauthError) return fail("reauth", 401);
    console.error(err);
    return fail("Couldn't read your email. Try again.", 502);
  }
}
