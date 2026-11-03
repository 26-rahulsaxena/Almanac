import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { ReauthError } from "@/lib/google";
import { ensureState, loadPriorities } from "@/lib/priorities";
import { SAFETY_MS, SEVERITIES } from "@/lib/priority";

const ACTIONS = ["severity", "deadline", "doing", "later", "done", "stuck", "open"];

async function me() {
  const id = (await auth())?.user?.id;
  if (!id) return null;
  const [u] = await sql<{ timezone: string; hidden_calendars: string[] }[]>`select timezone, hidden_calendars from users where id = ${id}`;
  return u ? { id, ...u } : null;
}

const fail = (error: string, status = 400) => Response.json({ error }, { status });

// GET /api/priorities → deadlines in the next 5 days, most urgent first.
export async function GET() {
  const u = await me();
  if (!u) return fail("signin", 401);
  try {
    return Response.json(await loadPriorities(u.id, u.timezone, u.hidden_calendars));
  } catch (err) {
    if (err instanceof ReauthError) return fail("reauth", 401);
    throw err;
  }
}

// POST /api/priorities {calendarId, eventId, action, ...} → change one deadline, returns the updated list.
//   severity {severity | null}   deadline {deadline: true | false | null}   doing {minutes}
//   later {until: ISO}           done, stuck, open (undo)
export async function POST(req: Request) {
  const u = await me();
  if (!u) return fail("signin", 401);
  const b = await req.json().catch(() => null);
  const { calendarId, eventId, action } = b ?? {};
  if (typeof calendarId !== "string" || calendarId.length > 300 || typeof eventId !== "string" || eventId.length > 1024 || !ACTIONS.includes(action)) {
    return fail("Invalid request");
  }

  try {
    const row = await ensureState(u.id, u.timezone, calendarId, eventId);
    const where = sql`where id = ${row.id}`;
    switch (action) {
      case "severity":
        if (b.severity !== null && !SEVERITIES.includes(b.severity)) return fail("Invalid severity");
        await sql`update deadline_states set severity_override = ${b.severity} ${where}`;
        break;
      case "deadline":
        if (![true, false, null].includes(b.deadline)) return fail("Invalid choice");
        await sql`update deadline_states set is_deadline = ${b.deadline} ${where}`;
        break;
      case "doing":
        if (!Number.isInteger(b.minutes) || b.minutes < 15 || b.minutes > 480) return fail("Pick between 15 minutes and 8 hours");
        await sql`update deadline_states set status = 'doing', next_check_at = now() + make_interval(mins => ${b.minutes}) ${where}`;
        break;
      case "later": {
        const until = new Date(b.until);
        // Never later than 2 hours before the deadline.
        if (isNaN(+until) || +until < Date.now() + 5 * 60_000 || +until > +row.due_at - SAFETY_MS + 60_000) return fail("That's too close to the deadline");
        await sql`update deadline_states set status = 'later', next_check_at = ${until}, later_count = later_count + 1 ${where}`;
        break;
      }
      case "done":
        await sql`update deadline_states set status = 'done', next_check_at = null ${where}`;
        break;
      case "stuck":
        await sql`update deadline_states set status = 'stuck', next_check_at = now() + interval '1 hour' ${where}`;
        break;
      case "open":
        await sql`update deadline_states set status = 'open', next_check_at = null ${where}`;
        break;
    }
    return Response.json(await loadPriorities(u.id, u.timezone, u.hidden_calendars));
  } catch (err) {
    if (err instanceof ReauthError) return fail("reauth", 401);
    console.error(err);
    return fail("Couldn't update that deadline. Try again.", 502);
  }
}
