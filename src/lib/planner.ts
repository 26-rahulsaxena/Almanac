// Server side of planning: reads what's coming up, books blocks of time, and links to-dos to them.
// Used by the to-do list and the assistant.

import { listCalendars, listEvents, type Cal } from "./calendar";
import { sql } from "./db";
import { gcal } from "./google";
import { pickSlot } from "./plan";
import { ensureState } from "./priorities";
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
};

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
  b: { title: string; start: Date; end: Date; description?: string; reminderMinutes?: number },
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
    }),
  });
  return { calendarId: cal.id, eventId: e.id };
}

export const listTodos = (userId: string) =>
  sql<Todo[]>`
    select id, title, due_at, minutes, done, calendar_id, event_id, scheduled_at from todos
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
  });
  // shortcut: scheduled_at is the time it was booked for; moving the block in Google later isn't reflected here.
  await sql`update todos set calendar_id = ${where.calendarId}, event_id = ${where.eventId}, scheduled_at = ${slot.start} where id = ${t.id}`;
  return slot;
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
