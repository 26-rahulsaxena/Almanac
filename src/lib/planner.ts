// Server side of planning: reads what's coming up, books blocks of time, and links to-dos to them.
// Used by the to-do list and the assistant.

import { autoPlan, type PlanRoutine, type PlanTodo, type TimeOfDay } from "./autoplan";
import { listCalendars, listEvents, type Cal, type Ev } from "./calendar";
import { clashFixes } from "./coach";
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
  b: { title: string; start: Date; end: Date; description?: string; reminderMinutes?: number; plan?: string; prep?: string },
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
      // Private tags (only this app sees them): almanacPlan marks the auto-planner's own blocks, the only events it
      // may move; almanacPrep names the deadline a prep block is for, so that deadline isn't suggested again.
      ...((b.plan || b.prep) && { extendedProperties: { private: { ...(b.plan && { almanacPlan: b.plan }), ...(b.prep && { almanacPrep: b.prep }) } } }),
    }),
  });
  return { calendarId: cal.id, eventId: e.id };
}

// Changes one of Almanac's own blocks in Google; on your other events only for a move you approved.
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

export type Replan = { booked: string[]; moved: string[]; unplaced: string[]; suggested: string[] };

// Runs the auto-planner for one user: time for automatic to-dos and habits, and Almanac's own blocks that
// something else now overlaps moved out of the way. rollover: also unfinished to-dos whose time has passed, to
// tomorrow or later. In "ask" mode (the default) these only become suggestions you approve; in "auto" mode they're
// carried out in Google. Returns what changed or was suggested, in words; null if a run for this user is going.
export async function replan(u: User, opts: { rollover?: boolean } = {}): Promise<Replan | null> {
  // One run per user at a time (the minute job and a click can overlap). Marked on the user row rather than with a
  // lock that keeps a database connection open for the whole run: connections are scarce (see db.ts). The mark
  // expires by itself in 2 minutes in case a run dies halfway.
  const [claim] = await sql`
    update users set planning_until = now() + interval '2 minutes'
    where id = ${u.id} and (planning_until is null or planning_until < now()) returning id`;
  if (!claim) return null;
  try {
    return await planNow(u, !!opts.rollover);
  } finally {
    await sql`update users set planning_until = null where id = ${u.id}`;
  }
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
  const titleOf = (kind: "todo" | "routine", id: string) => (kind === "todo" ? todos.find((t) => t.id === id) : routines.find((r) => r.id === id))?.title ?? "";
  const changes: Change[] = plan.placements.map((p) => {
    const e = p.from ? blockOf.get(p.from) : undefined;
    // What it's about (a to-do's booking, one day's session of a habit, or one block to move), then the time.
    const item = `${p.kind}:${p.id}:${e?.id ?? (p.kind === "routine" ? `new:${ymdIn(p.to.start, tz)}` : "new")}`;
    return {
      key: `${item}|${+p.to.start}`,
      kind: p.kind,
      item_id: p.id,
      title: titleOf(p.kind, p.id),
      reason: !e ? "new" : planTodos.find((t) => t.id === p.id)?.move ? "rollover" : "clash",
      from_calendar_id: e?.calendarId ?? null,
      from_event_id: e?.id ?? null,
      from_start: p.from?.start ?? null,
      to_start: p.to.start,
      to_end: p.to.end,
    };
  });
  const out: Replan = { booked: [], moved: [], unplaced: plan.unplaced.map((p) => titleOf(p.kind, p.id)), suggested: [] };

  // Ask-first mode: nothing changes; the plan becomes suggestions for you to approve.
  const [{ plan_mode }] = await sql<{ plan_mode: "ask" | "auto" }[]>`select plan_mode from users where id = ${u.id}`;
  if (plan_mode === "ask") {
    out.suggested = await saveSuggestions(u, changes, ["todo", "routine"]);
    return out;
  }
  for (const c of changes) {
    try {
      await apply(u, calendars, c);
      (c.from_event_id ? out.moved : out.booked).push(`${c.title} → ${whenIn(c.to_start, tz)}`);
    } catch (err) {
      console.error(`Auto-plan: couldn't place ${c.kind} ${c.item_id}:`, err);
      out.unplaced.push(c.title);
    }
  }
  return out;
}

// One change the planner wants: book a new block (from_* null) or move an existing one. "event": one of your own
// events that the morning check suggests moving (item_id null).
type Change = {
  key: string;
  kind: "todo" | "routine" | "event";
  item_id: string | null;
  title: string;
  reason: "new" | "clash" | "rollover";
  from_calendar_id: string | null;
  from_event_id: string | null;
  from_start: Date | null;
  to_start: Date;
  to_end: Date;
};
export type Suggestion = Change & { id: string };

const whenIn = (d: Date, tz: string) => d.toLocaleString("en-IN", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" });

// Carries out a change in Google (and on the to-do it belongs to).
async function apply(u: User, calendars: Cal[], c: Change) {
  const to = { start: c.to_start, end: c.to_end };
  if (c.from_event_id) {
    await moveBlock(u, c.from_calendar_id!, c.from_event_id, to);
    if (c.kind === "todo") await sql`update todos set scheduled_at = ${c.to_start} where id = ${c.item_id}`;
    return;
  }
  const where = await bookBlock(u, calendars, {
    title: c.title,
    start: c.to_start,
    end: c.to_end,
    description: c.kind === "todo" ? "Booked from your Almanac to-do list." : "Focus time / habit from Almanac. It moves itself if something else needs this time.",
    reminderMinutes: 10,
    plan: `${c.kind}:${c.item_id}`,
  });
  if (c.kind === "todo") await sql`update todos set calendar_id = ${where.calendarId}, event_id = ${where.eventId}, scheduled_at = ${c.to_start} where id = ${c.item_id}`;
}

// The thing a suggestion is about, whatever time it proposes: the part of its key before "|".
const itemOf = (key: string) => key.split("|")[0];

// Keeps the waiting suggestions of these kinds in step with the latest plan: out-of-date ones go, new ones are
// added, and items you said "Not now" to stay quiet for 6 hours. Returns, in words, only suggestions about something
// that wasn't already waiting, so a time that shifts as the clock moves on doesn't notify you again.
async function saveSuggestions(u: User, changes: Change[], kinds: Change["kind"][]) {
  await sql`delete from plan_suggestions where user_id = ${u.id} and (dismissed_at < now() - interval '6 hours' or (dismissed_at is null and to_start < now()))`;
  const existing = await sql<{ key: string; dismissed_at: Date | null }[]>`select key, dismissed_at from plan_suggestions where user_id = ${u.id}`;
  const quiet = new Set(existing.filter((s) => s.dismissed_at).map((s) => itemOf(s.key)));
  const waiting = new Set(existing.filter((s) => !s.dismissed_at).map((s) => itemOf(s.key)));
  const wanted = changes.filter((c) => !quiet.has(itemOf(c.key)));
  await sql`delete from plan_suggestions where user_id = ${u.id} and dismissed_at is null and kind = any(${kinds}::text[]) and not (key = any(${wanted.map((c) => c.key)}::text[]))`;
  if (!wanted.length) return [];
  const added = await sql<{ key: string; title: string; to_start: Date; from_event_id: string | null }[]>`
    insert into plan_suggestions ${sql(wanted.map((c) => ({ ...c, user_id: u.id })))}
    on conflict (user_id, key) do nothing
    returning key, title, to_start, from_event_id`;
  return added.filter((s) => !waiting.has(itemOf(s.key))).map((s) => `${s.from_event_id ? "Move" : "Book"} ${s.title} → ${whenIn(s.to_start, u.timezone)}`);
}

export const listSuggestions = (userId: string) =>
  sql<Suggestion[]>`
    select id, key, kind, item_id, title, reason, from_calendar_id, from_event_id, from_start, to_start, to_end from plan_suggestions
    where user_id = ${userId} and dismissed_at is null and to_start > now()
    order by to_start`;

// You approved a suggestion: carry it out, if it still makes sense.
export async function approveSuggestion(u: User, id: string) {
  const [s] = await sql<Suggestion[]>`delete from plan_suggestions where id = ${id} and user_id = ${u.id} and dismissed_at is null returning *`;
  if (!s) throw new InvalidInput("That suggestion is out of date. The list has been refreshed.");
  if (s.kind === "todo" && !s.from_event_id) {
    const [t] = await sql<Todo[]>`select * from todos where id = ${s.item_id} and user_id = ${u.id}`;
    if (!t || t.done || t.event_id) return; // gone, done, or booked some other way meanwhile
  }
  if (s.kind === "routine" && !s.from_event_id) {
    const [r] = await sql`select 1 from routines where id = ${s.item_id} and user_id = ${u.id}`;
    if (!r) return;
  }
  if (s.kind === "event") {
    // Your own event: move it only if it's still where it was and the new time is still free.
    const { events } = await upcoming(u, new Date(Math.min(+s.from_start!, +s.to_start)), 1);
    const e = events.find((x) => x.id === s.from_event_id && x.calendarId === s.from_calendar_id);
    const taken = events.some((x) => x !== e && x.busy && !x.allDay && new Date(x.start) < s.to_end && new Date(x.end) > s.to_start);
    if (!e || +new Date(e.start) !== +s.from_start! || taken) throw new InvalidInput("That event or its new time changed since this was suggested, so nothing was moved.");
  }
  await apply(u, await listCalendars(u.id), s);
}

// The morning check (once a day, in either planning mode, since it's about your own events): today's clashes
// become suggestions to move one of the pair. Returns the new ones in words.
export async function morningCheck(u: User, now = new Date()) {
  const { calendars, events } = await upcoming(u, midnightIn(ymdIn(now, u.timezone), u.timezone), 1);
  const editable = new Set(calendars.filter((c) => c.canEdit).map((c) => c.id));
  const fixes: Change[] = clashFixes(events, editable, now, u.timezone).map(({ event: e, to }) => ({
    key: `event:${e.calendarId}/${e.id}|${+to.start}`,
    kind: "event",
    item_id: null,
    title: e.title,
    reason: "clash",
    from_calendar_id: e.calendarId,
    from_event_id: e.id,
    from_start: new Date(e.start),
    to_start: to.start,
    to_end: to.end,
  }));
  return saveSuggestions(u, fixes, ["event"]);
}

export const dismissSuggestion = (u: User, id: string) => sql`update plan_suggestions set dismissed_at = now() where id = ${id} and user_id = ${u.id}`;

// Ticking a to-do also ticks its calendar block in Priorities (and unticking reopens it).
export async function setTodoDone(u: User, todoId: string, done: boolean) {
  const [t] = await sql<Todo[]>`update todos set done = ${done}, done_at = ${done ? new Date() : null} where id = ${todoId} and user_id = ${u.id} returning *`;
  if (!t) throw new InvalidInput("That to-do no longer exists.");
  if (t.calendar_id && t.event_id) {
    const row = await ensureState(u.id, u.timezone, t.calendar_id, t.event_id).catch(() => null); // block may have been deleted
    if (row) await sql`update deadline_states set status = ${done ? "done" : "open"}, next_check_at = null where id = ${row.id}`;
  }
}
