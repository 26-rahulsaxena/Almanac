import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { ReauthError } from "@/lib/google";
import { addFind, FIELDS, waitingFinds, type MailFind } from "@/lib/mail";
import { me } from "@/lib/planner";
import { InvalidInput } from "@/lib/validate";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = (error: string, status = 400) => Response.json({ error }, { status });

// GET /api/mail → what was found in your email and is waiting for Add / Not now (Ask-first mode).
export async function GET() {
  const u = await me((await auth())?.user?.id);
  if (!u) return fail("signin", 401);
  return Response.json(await waitingFinds(u.id));
}

// POST /api/mail {id, action: "add" | "dismiss"} → answers with the fresh list.
export async function POST(req: Request) {
  const session = await auth();
  const u = await me(session?.user?.id);
  if (!u) return fail("signin", 401);
  const b = await req.json().catch(() => null);
  if (!UUID.test(b?.id ?? "") || !["add", "dismiss"].includes(b?.action)) return fail("Invalid request");
  try {
    // Taken off the waiting list first, so a double tap can't add it twice.
    const [f] = await sql<MailFind[]>`
      update mail_finds set status = 'dismissed' where id = ${b.id} and user_id = ${u.id} and status = 'waiting'
      returning ${sql.unsafe(FIELDS)}`;
    if (!f) throw new InvalidInput("That's already been answered. The list has been refreshed.");
    if (b.action === "add") {
      const [{ email }] = await sql<{ email: string }[]>`select email from users where id = ${u.id}`;
      await addFind({ ...u, email }, f).catch(async (err) => {
        await sql`update mail_finds set status = 'waiting' where id = ${f.id}`; // still there to try again
        throw err;
      });
    }
    return Response.json(await waitingFinds(u.id));
  } catch (err) {
    if (err instanceof InvalidInput) return Response.json({ error: err.message, list: await waitingFinds(u.id) }, { status: 409 });
    if (err instanceof ReauthError) return fail("reauth", 401);
    console.error(err);
    return fail("Couldn't add it. Try again.", 502);
  }
}
