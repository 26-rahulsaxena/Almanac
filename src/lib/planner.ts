// Server side of planning: reads what's coming up, books blocks of time, and links to-dos to them.
// Used by the to-do list and the assistant.

import { autoPlan, type PlanRoutine, type PlanTodo, type TimeOfDay } from "./autoplan";
import { listCalendars, listEvents, type Cal, type Ev } from "./calendar";
import { sql } from "./db";
import { gcal } from "./google";
import { pickSlot, ymdIn } from "./plan";
import { ensureState } from "./priorities";
import { shiftDate } from "./recurrence";
import { midnightIn } from "./reminders";
import type { Interval } from "./time";
import { InvalidInput } from "./validate";

const DAY = 86_400_000;

export type User = { id: string; timezone: string; hidden_calendars: string[] };

export type Todo = {
  id: string;
  title: string;
  due_at: Date | null;
  minutes: number;
  done: boolean;
  calendar_id: string | null;
  event_id: string | null;
  scheduled_at: Date | null;
  auto: boolean; // Almanac finds a time and keeps it clear of new events
  group_id: string | null; // parts of one task split into sessions
};
export type Routine = { id: string; title: string; minutes: number; per_week: number; time_of_day: TimeOfDay };

export async function me(id: string | undefined): Promise<User | null> {
  if (!id) return null;
  const [u] = await sql<User[]>`select id, timezone, hidden_calendars from users where id = ${id}`;
  return u ?? null;
}

// Events on the visible calendars from `from` for `days` days, leaving out invites you declined.
export async function upcoming(u: User, from: Date, days: number) {
  const calendars = (await listCalendars(u.id)).filter((c) => !u.hidden_calendars.includes(c.id));
  const events = await listEvents(u.id, calendars.map((c) => c.id), from.toISOString(), new Date(+from + days * DAY).toISOString());
  return { calendars, events: events.filter((e) => e.attendees?.find((a) => a.self)?.responseStatus !== "declined") };
}

// A plain block of time on your main calendar. Never has guests, so nobody else is ever emailed.
export async function bookBlock(
  u: User,
  calendars: Cal[],
  b: { title: string; start: Date; end: Date; description?: string; reminderMinutes?: number; plan?: string },
) {
  const cal = calendars.find((c) => c.primary && c.canEdit) ?? calendars.find((c) => c.canEdit);
  if (!cal) throw new InvalidInput("There's no calendar you can add to.");
  const e = await gcal<{ id: string }>(u.id, `/calendars/${encodeURIComponent(cal.id)}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: b.title,
      description: b.description,
      start: { dateTime: b.start.toISOString() },
      end: { dateTime: b.end.toISOString() },
      ...(b.reminderMinutes != null && { reminders: { useDefault: false, overrides: [{ method: "popup", minutes: b.reminderMinutes }] } }),
      // A private tag (only this app sees it) marks the auto-planner's own blocks, the only events it may move.
      ...(b.plan && { extendedProperties: { private: { almanacPlan: b.plan } } }),
    }),
  });
  return { calendarId: cal.id, eventId: e.id };
}

// Changes one of Almanac's own blocks in Google (never used on your other events).
const patchBlock = (u: User, calendarId: string, eventId: string, body: object) =>
  gcal(u.id, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
export const moveBlock = (u: User, calendarId: string, eventId: string, to: Interval) =>
  patchBlock(u, calendarId, eventId, { start: { dateTime: to.start.toISOString() }, end: { dateTime: to.end.toISOString() } });
export const renameBlock = (u: User, calendarId: string, eventId: string, title: string, to: Interval) =>
  patchBlock(u, calendarId, eventId, { summary: title, start: { dateTime: to.start.toISOString() }, end: { dateTime: to.end.toISOString() } });
export const deleteBlock = (u: User, calendarId: string, eventId: string) =>
  gcal(u.id, `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });

export const listTodos = (userId: string) =>
  sql<Todo[]>`
    select id, title, due_at, minutes, done, calendar_id, event_id, scheduled_at, auto, group_id from todos
    where user_id = ${userId} and (not done or created_at > now() - interval '2 days')
    order by done, due_at nulls last, created_at`;

// Gives a to-do its own block on the calendar: at `start` if given, otherwise the first free waking-hours slot
// (finishing before it's due). The block then shows up in Priorities like any event.
export async function scheduleTodo(u: User, todoId: string, start?: Date) {
  const [t] = await sql<Todo[]>`select * from todos where id = ${todoId} and user_id = ${u.id}`;
  if (!t) throw new InvalidInput("That to-do no longer exists.");
  if (t.event_id) throw new InvalidInput("It's already on your calendar.");
  const now = new Date();
  const { calendars, events } = await upcoming(u, now, 7);
  const slot = start
    ? { start, end: new Date(+start + t.minutes * 60_000) }
    : pickSlot(events, now, u.timezone, t.minutes, t.due_at);
  if (!slot) throw new InvalidInput(t.due_at ? "No free time before it's due. Book a time yourself." : "No free time in the next 7 days.");
  const where = await bookBlock(u, calendars, {
    title: t.title,
    start: slot.start,
    end: slot.end,
    description: "Booked from your Almanac to-do list.",
    reminderMinutes: 10,
    plan: `todo:${t.id}`,
  });
  // shortcut: scheduled_at is the time it was booked for; moving the block in Google later isn't reflected here.
  await sql`update todos set calendar_id = ${where.calendarId}, event_id = ${where.eventId}, scheduled_at = ${slot.start} where id = ${t.id}`;
  return slot;
}

export type Replan = { booked: string[]; moved: string[]; unplaced: string[] };

// Runs the auto-planner for one user and carries it out in Google: books time for automatic to-dos and habits,
// and moves Almanac's own blocks that something else now overlaps. rollover: also move unfinished to-dos whose
// time has passed to tomorrow or later (done once a night). Returns what changed, in words; null if another
// run for this user is already going.
export async function replan(u: User, opts: { rollover?: boolean } = {}): Promise<Replan | null> {
  // One run per user at a time (the minute job and a click can overlap); the lock ends with the transaction.
  return sql.begin(async (tx) => {
    const [{ ok }] = await tx<{ ok: boolean }[]>`select pg_try_advisory_xact_lock(hashtext(${u.id})) as ok`;
    return ok ? planNow(u, !!opts.rollover) : null;
  });
}

async function planNow(u: User, rollover: boolean): Promise<Replan> {
  const tz = u.timezone;
  const now = new Date();
  const today = ymdIn(now, tz);
  // From this week's Monday, so sessions already done this week count towards a habit's weekly total.
  const monday = shiftDate(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  const from = midnightIn(monday, tz);
  const to = midnightIn(shiftDate(today, 8), tz);
  const [{ calendars, events }, todos, routines] = await Promise.all([
    upcoming(u, from, Math.round((+to - +from) / DAY)),
    sql<Todo[]>`select * from todos where user_id = ${u.id} and not done and (auto or event_id is not null)`,
    sql<Routine[]>`select id, title, minutes, per_week, time_of_day from routines where user_id = ${u.id}`,
  ]);

  const key = (calendarId: string | null, id: string | null) => `${calendarId}/${id}`;
  const byKey = new Map(events.map((e) => [key(e.calendarId, e.id), e]));
  const span = (e: Ev): Interval => ({ start: new Date(e.start), end: new Date(e.end) });
  const blockOf = new Map<Interval, Ev>(); // which Google event each block came from, to move it
  const routineIds = new Set(routines.map((r) => r.id));
  const todoBlocks = new Set(todos.map((t) => key(t.calendar_id, t.event_id)));
  // Fixed: everything except Almanac's blocks for current to-dos and habits. All-day events (deadlines, holidays,
  // birthdays) don't take up time.
  const mine = (e: Ev) => todoBlocks.has(key(e.calendarId, e.id)) || (e.plan?.startsWith("routine:") && routineIds.has(e.plan.slice(8)));
  const busy = events.filter((e) => e.busy && !e.allDay && !mine(e)).map(span);

  const visible = new Set(calendars.map((c) => c.id));
  const tomorrow = midnightIn(shiftDate(today, 1), tz);
  const planTodos: PlanTodo[] = [];
  for (const t of todos) {
    let block: Interval | null = null;
    if (t.event_id) {
      const e = byKey.get(key(t.calendar_id, t.event_id));
      if (!e) {
        // Gone from a calendar we can see, at a time we looked at: you deleted the block, so stop planning it.
        if (visible.has(t.calendar_id!) && t.scheduled_at && t.scheduled_at >= from && t.scheduled_at < to) {
          await sql`update todos set calendar_id = null, event_id = null, scheduled_at = null, auto = false where id = ${t.id}`;
        }
        continue;
      }
      block = span(e);
      blockOf.set(block, e);
      if (+block.start !== +(t.scheduled_at ?? 0)) await sql`update todos set scheduled_at = ${block.start} where id = ${t.id}`; // moved in Google
      if (block.end <= now && !rollover) continue; // its time has passed; unfinished ones move at night
    } else if (!t.auto) continue;
    const unfinished = !!block && block.end <= now;
    planTodos.push({ id: t.id, minutes: t.minutes, due: t.due_at, group: t.group_id, block, move: unfinished, notBefore: unfinished ? tomorrow : undefined });
  }

  const planRoutines: PlanRoutine[] = routines.map((r) => ({
    id: r.id,
    minutes: r.minutes,
    perWeek: r.per_week,
    timeOfDay: r.time_of_day,
    blocks: events
      .filter((e) => e.plan === `routine:${r.id}`)
      .map((e) => {
        const b = span(e);
        blockOf.set(b, e);
        return b;
      }),
  }));

  const plan = autoPlan(busy, planTodos, planRoutines, now, tz);
  const when = (d: Date) => d.toLocaleString("en-IN", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" });
  const titleOf = (kind: "todo" | "routine", id: string) => (kind === "todo" ? todos.find((t) => t.id === id) : routines.find((r) => r.id === id))?.title ?? "";
  const out: Replan = { booked: [], moved: [], unplaced: [] };
  for (const p of plan.placements) {
    const title = titleOf(p.kind, p.id);
    try {
      const e = p.from && blockOf.get(p.from);
      if (e) {
        await moveBlock(u, e.calendarId, e.id, p.to);
        if (p.kind === "todo") await sql`update todos set scheduled_at = ${p.to.start} where id = ${p.id}`;
        out.moved.push(`${title} → ${when(p.to.start)}`);
      } else {
        const where = await bookBlock(u, calendars, {
          title,
          start: p.to.start,
          end: p.to.end,
          description: p.kind === "todo" ? "Booked from your Almanac to-do list." : "Focus time / habit from Almanac. It moves itself if something else needs this time.",
          reminderMinutes: 10,
          plan: `${p.kind}:${p.id}`,
        });
        if (p.kind === "todo") await sql`update todos set calendar_id = ${where.calendarId}, event_id = ${where.eventId}, scheduled_at = ${p.to.start} where id = ${p.id}`;
        out.booked.push(`${title} → ${when(p.to.start)}`);
      }
    } catch (err) {
      console.error(`Auto-plan: couldn't place ${p.kind} ${p.id}:`, err);
      out.unplaced.push(title);
    }
  }
  for (const p of plan.unplaced) out.unplaced.push(titleOf(p.kind, p.id));
  return out;
}

// Ticking a to-do also ticks its calendar block in Priorities (and unticking reopens it).
export async function setTodoDone(u: User, todoId: string, done: boolean) {
  const [t] = await sql<Todo[]>`update todos set done = ${done} where id = ${todoId} and user_id = ${u.id} returning *`;
  if (!t) throw new InvalidInput("That to-do no longer exists.");
  if (t.calendar_id && t.event_id) {
    const row = await ensureState(u.id, u.timezone, t.calendar_id, t.event_id).catch(() => null); // block may have been deleted
    if (row) await sql`update deadline_states set status = ${done ? "done" : "open"}, next_check_at = null where id = ${row.id}`;
  }
}
