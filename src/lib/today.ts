// The four numbers at the top of Today: events today, time booked in them, unread mail, and to-dos due by tonight.
// Counted from what Almanac already reads (the calendar, Gmail, the to-do list); nothing new is kept.

import type { Ev } from "./calendar";
import { unreadCounts } from "./inbox";
import { midnightIn } from "./reminders";
import { ymdIn } from "./plan";
import { listTodos, upcoming, type User } from "./planner";

export type TodayCounts = { events: number; minutes: number; unread: number | null; todos: number; overdue: number };

// Pure: what's counted. Almanac's own to-do and routine blocks are tasks, not events, and all-day ones ("Project
// week") are no appointment, so both are left out, as in the Today card under the tiles; minutes
// is the time the rest take up today (overlaps once, all-day and "free" events not at all). day: today as
// "YYYY-MM-DD", from / to: its midnights (all-day events go by date, as Google gives them).
export function count(events: Ev[], todos: { due_at: Date | null; done: boolean }[], day: string, from: Date, to: Date): Omit<TodayCounts, "unread"> {
  const today = events.filter((e) => !e.plan && (e.allDay ? e.start <= day && e.end > day : +new Date(e.start) < +to && +new Date(e.end) > +from));
  const spans = today
    .filter((e) => !e.allDay && e.busy && !e.away)
    .map((e) => [Math.max(+new Date(e.start), +from), Math.min(+new Date(e.end), +to)] as const)
    .sort((a, b) => a[0] - b[0]);
  let ms = 0;
  let reach = -Infinity;
  for (const [s, e] of spans) {
    if (e > reach) ms += e - Math.max(s, reach);
    reach = Math.max(reach, e);
  }
  const open = todos.filter((t) => !t.done && t.due_at && +t.due_at < +to);
  return { events: today.filter((e) => !e.allDay).length, minutes: Math.round(ms / 60_000), todos: open.length, overdue: open.filter((t) => +t.due_at! < +from).length };
}

// Unread conversations in the Primary inbox across your accounts. null: no Gmail connected.
async function unreadCount(userId: string) {
  const counts = await unreadCounts(userId);
  return counts.length ? counts.reduce((n, c) => n + c.unread, 0) : null;
}

export async function todayCounts(u: User, now = new Date()): Promise<TodayCounts> {
  const day = ymdIn(now, u.timezone);
  const from = midnightIn(day, u.timezone);
  const to = midnightIn(ymdIn(new Date(+from + 36 * 3_600_000), u.timezone), u.timezone); // the next midnight, DST-safe
  const [{ events }, todos, unread] = await Promise.all([upcoming(u, from, 1, true), listTodos(u.id), unreadCount(u.id)]);
  return { ...count(events, todos, day, from, to), unread };
}
