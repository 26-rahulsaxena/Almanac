import { randomUUID } from "node:crypto";
import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { ReauthError } from "@/lib/google";
import { deleteBlock, listTodos, me, renameBlock, replan, scheduleTodo, setTodoDone, type Todo, type User } from "@/lib/planner";
import { InvalidInput } from "@/lib/validate";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SESSIONS = [45, 60, 90, 120]; // session lengths a long task can be split into
const fail = (error: string, status = 400) => Response.json({ error }, { status });

async function user() {
  return me((await auth())?.user?.id);
}

// Runs a change, then answers with the fresh list (or a message the user can read). plan: run the auto-planner
// afterwards, so a new or changed automatic to-do gets its time straight away.
async function respond(u: User, change: () => Promise<unknown>, plan = false) {
  try {
    await change();
    if (plan) await replan(u);
    return Response.json(await listTodos(u.id));
  } catch (err) {
    if (err instanceof InvalidInput) return fail(err.message);
    if (err instanceof ReauthError) return fail("reauth", 401);
    console.error(err);
    return fail("Couldn't update your to-do list. Try again.", 502);
  }
}

function parseTitle(v: unknown) {
  const title = typeof v === "string" ? v.trim() : "";
  if (!title || title.length > 200) throw new InvalidInput("Give the to-do a short name (up to 200 characters).");
  return title;
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

// POST /api/todos {title, due?, minutes?, auto?, split?} → adds one. auto: Almanac books and keeps a time for it.
// split: a session length; a long task becomes "Title (1/4)", "(2/4)"… each booked on a different day.
export async function POST(req: Request) {
  const u = await user();
  if (!u) return fail("signin", 401);
  const b = await req.json().catch(() => null);
  const auto = b?.auto === true;
  return respond(
    u,
    async () => {
      const title = parseTitle(b?.title);
      const due = parseDue(b.due);
      const minutes = parseMinutes(b.minutes);
      if (b.split == null) return sql`insert into todos (user_id, title, due_at, minutes, auto) values (${u.id}, ${title}, ${due}, ${minutes}, ${auto})`;
      if (!SESSIONS.includes(b.split)) throw new InvalidInput("Pick a session length.");
      const parts = Math.ceil(minutes / b.split);
      if (parts < 2) throw new InvalidInput("That's already one session.");
      const group = randomUUID();
      const rows = Array.from({ length: parts }, (_, i) => ({
        user_id: u.id,
        title: `${title} (${i + 1}/${parts})`,
        due_at: due,
        minutes: i < parts - 1 ? b.split : minutes - b.split * (parts - 1),
        auto,
        group_id: group,
      }));
      await sql`insert into todos ${sql(rows)}`;
    },
    auto,
  );
}

// PATCH /api/todos
//   {id, done}                          → tick it off (or back on)
//   {id, schedule: true, start?}        → book time for it now
//   {id, title, due, minutes, auto}     → edit it; its calendar block (if any) is renamed and resized to match
export async function PATCH(req: Request) {
  const u = await user();
  if (!u) return fail("signin", 401);
  const b = await req.json().catch(() => null);
  if (!UUID.test(b?.id ?? "")) return fail("Invalid request");
  if (typeof b.done === "boolean") return respond(u, () => setTodoDone(u, b.id, b.done));
  if (b.schedule === true) return respond(u, () => scheduleTodo(u, b.id, b.start ? (parseDue(b.start) ?? undefined) : undefined));
  if (b.title === undefined) return fail("Nothing to change.");
  return respond(
    u,
    async () => {
      const [t] = await sql<Todo[]>`
        update todos set title = ${parseTitle(b.title)}, due_at = ${parseDue(b.due)}, minutes = ${parseMinutes(b.minutes)}, auto = ${b.auto === true}
        where id = ${b.id} and user_id = ${u.id} returning *`;
      if (!t) throw new InvalidInput("That to-do no longer exists.");
      if (t.event_id && t.scheduled_at) {
        await renameBlock(u, t.calendar_id!, t.event_id, t.title, { start: t.scheduled_at, end: new Date(+t.scheduled_at + t.minutes * 60_000) });
      }
    },
    b.auto === true,
  );
}

// DELETE /api/todos {id, removeBlock?} → removes it from the list. Its calendar block goes too only when the
// person said so (removeBlock: true, asked in the app); otherwise the block stays on the calendar.
export async function DELETE(req: Request) {
  const u = await user();
  if (!u) return fail("signin", 401);
  const b = await req.json().catch(() => null);
  if (!UUID.test(b?.id ?? "")) return fail("Invalid request");
  return respond(u, async () => {
    const [t] = await sql<Todo[]>`delete from todos where id = ${b.id} and user_id = ${u.id} returning *`;
    if (t?.event_id && b.removeBlock === true) await deleteBlock(u, t.calendar_id!, t.event_id).catch(() => {}); // already gone is fine
  });
}
