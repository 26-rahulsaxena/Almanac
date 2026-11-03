import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { ReauthError } from "@/lib/google";
import { listTodos, me, scheduleTodo, setTodoDone } from "@/lib/planner";
import { InvalidInput } from "@/lib/validate";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = (error: string, status = 400) => Response.json({ error }, { status });

async function user() {
  return me((await auth())?.user?.id);
}

// Runs a change, then answers with the fresh list (or a message the user can read).
async function respond(userId: string, change: () => Promise<unknown>) {
  try {
    await change();
    return Response.json(await listTodos(userId));
  } catch (err) {
    if (err instanceof InvalidInput) return fail(err.message);
    if (err instanceof ReauthError) return fail("reauth", 401);
    console.error(err);
    return fail("Couldn't update your to-do list. Try again.", 502);
  }
}

function parseDue(v: unknown) {
  if (v == null || v === "") return null;
  const d = new Date(String(v));
  if (isNaN(+d) || +d < Date.now() - 366 * 86_400_000 || +d > Date.now() + 5 * 366 * 86_400_000) throw new InvalidInput("That due date doesn't look right.");
  return d;
}

function parseMinutes(v: unknown) {
  if (v === undefined) return 60;
  if (!Number.isInteger(v) || (v as number) < 5 || (v as number) > 720) throw new InvalidInput("Pick between 5 minutes and 12 hours.");
  return v as number;
}

// GET /api/todos → open to-dos (plus ones ticked off in the last 2 days).
export async function GET() {
  const u = await user();
  if (!u) return fail("signin", 401);
  return Response.json(await listTodos(u.id));
}

// POST /api/todos {title, due?, minutes?} → adds one.
export async function POST(req: Request) {
  const u = await user();
  if (!u) return fail("signin", 401);
  const b = await req.json().catch(() => null);
  return respond(u.id, async () => {
    const title = typeof b?.title === "string" ? b.title.trim() : "";
    if (!title || title.length > 200) throw new InvalidInput("Give the to-do a short name (up to 200 characters).");
    await sql`insert into todos (user_id, title, due_at, minutes) values (${u.id}, ${title}, ${parseDue(b.due)}, ${parseMinutes(b.minutes)})`;
  });
}

// PATCH /api/todos {id, done?} or {id, schedule: true, start?} → tick it off, or book time for it on the calendar.
export async function PATCH(req: Request) {
  const u = await user();
  if (!u) return fail("signin", 401);
  const b = await req.json().catch(() => null);
  if (!UUID.test(b?.id ?? "")) return fail("Invalid request");
  return respond(u.id, async () => {
    if (typeof b.done === "boolean") await setTodoDone(u, b.id, b.done);
    else if (b.schedule === true) await scheduleTodo(u, b.id, b.start ? (parseDue(b.start) ?? undefined) : undefined);
    else throw new InvalidInput("Nothing to change.");
  });
}

// DELETE /api/todos {id} → removes it from the list. A block already booked for it stays on the calendar.
export async function DELETE(req: Request) {
  const u = await user();
  if (!u) return fail("signin", 401);
  const b = await req.json().catch(() => null);
  if (!UUID.test(b?.id ?? "")) return fail("Invalid request");
  return respond(u.id, () => sql`delete from todos where id = ${b.id} and user_id = ${u.id}`);
}
