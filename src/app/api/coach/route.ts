import { auth } from "@/auth";
import { listCalendars } from "@/lib/calendar";
import { coachToday, coachWeek } from "@/lib/coach-data";
import { ReauthError } from "@/lib/google";
import { bookBlock, me, scheduleTodo } from "@/lib/planner";
import { InvalidInput } from "@/lib/validate";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = (error: string, status = 400) => Response.json({ error }, { status });

async function guard(run: () => Promise<unknown>) {
  try {
    return Response.json(await run());
  } catch (err) {
    if (err instanceof InvalidInput) return fail(err.message);
    if (err instanceof ReauthError) return fail("reauth", 401);
    console.error(err);
    return fail("Couldn't read your calendar. Try again.", 502);
  }
}

// GET /api/coach → {now, today}: "What now?" and today's plan. GET /api/coach?view=week → the week in review.
export async function GET(req: Request) {
  const u = await me((await auth())?.user?.id);
  if (!u) return fail("signin", 401);
  return guard(() => (new URL(req.url).searchParams.get("view") === "week" ? coachWeek(u) : coachToday(u)));
}

// POST /api/coach {title, start, minutes, todoId?} → books the time a piece of advice suggested, because the
// person pressed its button. A to-do gets its own linked block; anything else a plain block (no guests).
export async function POST(req: Request) {
  const u = await me((await auth())?.user?.id);
  if (!u) return fail("signin", 401);
  const b = await req.json().catch(() => null);
  const title = typeof b?.title === "string" ? b.title.trim() : "";
  const start = new Date(String(b?.start));
  const minutes = b?.minutes;
  if (!title || title.length > 200 || isNaN(+start) || !Number.isInteger(minutes) || minutes < 5 || minutes > 720) return fail("Invalid request");
  if (+start < Date.now() - 10 * 60_000 || +start > Date.now() + 2 * 86_400_000) return fail("That time has passed. Ask again.");
  if (b.todoId !== undefined && !UUID.test(b.todoId)) return fail("Invalid request");
  return guard(async () => {
    if (b.todoId) await scheduleTodo(u, b.todoId, start);
    else await bookBlock(u, await listCalendars(u.id), { title, start, end: new Date(+start + minutes * 60_000), reminderMinutes: 10 });
    return { ok: true };
  });
}
