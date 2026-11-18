import { expect, test, vi } from "vitest";
vi.mock("./db", () => ({ sql: () => [] }));
const { count } = await import("./today");

const ev = (start: string, end: string, more: object = {}) => ({ id: start, calendarId: "c", title: "x", start, end, allDay: start.length === 10, busy: true, isOrganizer: true, ...more });
// Thu 19 Nov 2026 in India: midnight to midnight.
const from = new Date("2026-11-18T18:30:00Z");
const to = new Date("2026-11-19T18:30:00Z");

test("today's events and the time they take: overlaps once, no to-do blocks or all-day events", () => {
  const c = count(
    [
      ev("2026-11-19T10:00:00+05:30", "2026-11-19T11:00:00+05:30"),
      ev("2026-11-19T10:30:00+05:30", "2026-11-19T11:30:00+05:30"), // overlaps: 30 more minutes, not 60
      ev("2026-11-19T15:00:00+05:30", "2026-11-19T15:30:00+05:30", { plan: "todo:1" }), // a to-do block: a task
      ev("2026-11-19T16:00:00+05:30", "2026-11-19T17:00:00+05:30", { busy: false }), // marked free: counted, no time
      ev("2026-11-19", "2026-11-20"), // all day today
      ev("2026-11-18", "2026-11-19"), // all day yesterday: not today, though it ends after India's midnight in UTC
      ev("2026-11-18T23:00:00+05:30", "2026-11-19T01:00:00+05:30"), // from last night: only today's hour
    ],
    [
      { due_at: new Date("2026-11-19T12:00:00+05:30"), done: false },
      { due_at: new Date("2026-11-17T12:00:00+05:30"), done: false }, // overdue
      { due_at: new Date("2026-11-19T12:00:00+05:30"), done: true },
      { due_at: new Date("2026-11-20T12:00:00+05:30"), done: false }, // tomorrow
      { due_at: null, done: false },
    ],
    "2026-11-19",
    from,
    to,
  );
  expect(c).toEqual({ events: 4, minutes: 90 + 60, todos: 2, overdue: 1 }); // all-day: not counted, as in the Today card
});
