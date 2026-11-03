// Server side of the advice in coach.ts: reads the calendar (live from Google) and the to-do list, then asks the
// pure rules. Nothing it computes is stored.

import { dayPlan, weekReview, whatNow, workList } from "./coach";
import { sql } from "./db";
import { ymdIn } from "./plan";
import { listTodos, upcoming, type User } from "./planner";
import { dueAt, loadPriorities } from "./priorities";
import { classify, type Status } from "./priority";
import { midnightIn } from "./reminders";

const DAY = 86_400_000;

// "What now?" and today's plan, from today's events, Priorities and unbooked to-dos.
export async function coachToday(u: User, now = new Date()) {
  const midnight = midnightIn(ymdIn(now, u.timezone), u.timezone);
  const [{ events }, priorities, todos] = await Promise.all([upcoming(u, midnight, 2), loadPriorities(u.id, u.timezone, u.hidden_calendars, now), listTodos(u.id)]);
  const work = workList(todos, priorities, now, u.timezone);
  return { now: whatNow(events, work, now, u.timezone), today: dayPlan(events, work, now, u.timezone) };
}

// The last 7 days: your events, deadlines that fell in them (with whether you marked them done), and to-dos.
export async function coachWeek(u: User, now = new Date()) {
  const from = new Date(+now - 7 * DAY);
  const [{ events }, done, states, overdue] = await Promise.all([
    upcoming(u, from, 7),
    sql<{ title: string }[]>`select title from todos where user_id = ${u.id} and done and done_at >= ${from} order by done_at`,
    sql<{ calendar_id: string; event_id: string; status: Status }[]>`
      select calendar_id, event_id, status from deadline_states where user_id = ${u.id} and due_at >= ${from} and due_at <= ${now}`,
    sql<{ title: string }[]>`select title from todos where user_id = ${u.id} and not done and due_at < ${now} order by due_at`,
  ]);
  const statusOf = new Map(states.map((s) => [`${s.calendar_id}:${s.event_id}`, s.status]));
  const deadlines = events
    .filter((e) => classify(e).category === "deadline")
    .map((e) => ({ title: e.title, due_at: dueAt(e, u.timezone), status: statusOf.get(`${e.calendarId}:${e.id}`) ?? ("open" as Status) }));
  return weekReview(
    events,
    done.map((t) => t.title),
    deadlines,
    overdue.map((t) => t.title),
    now,
    u.timezone,
  );
}
