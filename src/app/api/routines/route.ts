import { auth } from "@/auth";
import { TIMES_OF_DAY } from "@/lib/autoplan";
import { sql } from "@/lib/db";
import { ReauthError } from "@/lib/google";
import { deleteBlock, me, replan, upcoming, type Routine, type User } from "@/lib/planner";
import { InvalidInput } from "@/lib/validate";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = (error: string, status = 400) => Response.json({ error }, { status });
const list = (userId: string) =>
  sql<Routine[]>`select id, title, minutes, per_week, time_of_day from routines where user_id = ${userId} order by created_at`;

async function respond(u: User, change: () => Promise<unknown>, plan = true) {
  try {
    await change();
    if (plan) await replan(u);
    return Response.json(await list(u.id));
  } catch (err) {
    if (err instanceof InvalidInput) return fail(err.message);
    if (err instanceof ReauthError) return fail("reauth", 401);
    console.error(err);
    return fail("Couldn't update your habits. Try again.", 502);
  }
}

function parse(b: Record<string, unknown> | null) {
  const title = typeof b?.title === "string" ? b.title.trim() : "";
  if (!title || title.length > 100) throw new InvalidInput("Give it a short name (up to 100 characters).");
  const minutes = b!.minutes as number;
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 480) throw new InvalidInput("Pick between 15 minutes and 8 hours.");
  const perWeek = b!.perWeek as number;
  if (!Number.isInteger(perWeek) || perWeek < 1 || perWeek > 7) throw new InvalidInput("Pick 1 to 7 times a week.");
  const timeOfDay = b!.timeOfDay as string;
  if (!(timeOfDay in TIMES_OF_DAY)) throw new InvalidInput("Pick a time of day.");
  return { title, minutes, perWeek, timeOfDay };
}

// GET /api/routines → your focus time and habits.
export async function GET() {
  const u = await me((await auth())?.user?.id);
  if (!u) return fail("signin", 401);
  return Response.json(await list(u.id));
}

// POST /api/routines {title, minutes, perWeek, timeOfDay} → adds one; Almanac books its sessions straight away.
export async function POST(req: Request) {
  const u = await me((await auth())?.user?.id);
  if (!u) return fail("signin", 401);
  const b = await req.json().catch(() => null);
  return respond(u, async () => {
    const r = parse(b);
    await sql`insert into routines (user_id, title, minutes, per_week, time_of_day) values (${u.id}, ${r.title}, ${r.minutes}, ${r.perWeek}, ${r.timeOfDay})`;
  });
}

// PATCH /api/routines {id, title, minutes, perWeek, timeOfDay} → changes it. Sessions already booked keep their
// time; missing ones are added.
export async function PATCH(req: Request) {
  const u = await me((await auth())?.user?.id);
  if (!u) return fail("signin", 401);
  const b = await req.json().catch(() => null);
  if (!UUID.test(b?.id ?? "")) return fail("Invalid request");
  return respond(u, async () => {
    const r = parse(b);
    await sql`
      update routines set title = ${r.title}, minutes = ${r.minutes}, per_week = ${r.perWeek}, time_of_day = ${r.timeOfDay}
      where id = ${b.id} and user_id = ${u.id}`;
  });
}

// DELETE /api/routines {id, removeBlocks?} → stops it. Its upcoming sessions are deleted from the calendar only when
// the person chose that in the app (removeBlocks: true); otherwise they stay as ordinary events.
export async function DELETE(req: Request) {
  const u = await me((await auth())?.user?.id);
  if (!u) return fail("signin", 401);
  const b = await req.json().catch(() => null);
  if (!UUID.test(b?.id ?? "")) return fail("Invalid request");
  return respond(
    u,
    async () => {
      const [r] = await sql<{ id: string }[]>`delete from routines where id = ${b.id} and user_id = ${u.id} returning id`;
      if (!r || b.removeBlocks !== true) return;
      const { events } = await upcoming(u, new Date(), 21);
      for (const e of events.filter((e) => e.plan === `routine:${r.id}`)) await deleteBlock(u, e.calendarId, e.id).catch(() => {});
    },
    false,
  );
}
