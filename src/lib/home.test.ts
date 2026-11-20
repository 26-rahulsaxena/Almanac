import { expect, test, vi } from "vitest";
vi.mock("./db", () => ({ sql: () => [] }));
vi.mock("./mail", () => ({ waitingFinds: () => [] })); // server-only (signs in with Google); not needed here
vi.mock("./coach-data", () => ({ gather: () => ({}) }));
const { buildActions } = await import("./home");

const tz = "Asia/Kolkata";
const now = new Date("2026-11-19T09:00:00+05:30"); // Thu morning
const at = (s: string) => new Date(`${s}+05:30`);
const todo = (id: string, due: string | null, more: object = {}) => ({ id, title: id, minutes: 60, due_at: due ? at(due) : null, done: false, event_id: null, scheduled_at: null, ...more });
const base = { priorities: [], risks: [], finds: [], suggestions: [], events: [] };

test("grouped Today, Overdue, This week, This month; undated and far-off left out", () => {
  const g = buildActions(
    { ...base, todos: [todo("today", "2026-11-19T18:00"), todo("late", "2026-11-18T20:00"), todo("week", "2026-11-22T12:00"), todo("month", "2026-12-10T12:00"), todo("someday", null), todo("far", "2027-02-01T12:00"), todo("done", "2026-11-19T18:00", { done: true })] },
    now,
    tz,
  );
  expect(Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.map((x) => x.title)]))).toEqual({ today: ["today"], overdue: ["late"], week: ["week"], month: ["month"] });
});

test("a to-do that fits before it's due can be booked; one that doesn't says so; a booked one says it's on", () => {
  const busy = [{ start: "2026-11-19T09:00:00+05:30", end: "2026-11-19T22:00:00+05:30", allDay: false, busy: true }]; // today is full
  const g = buildActions({ ...base, events: busy, todos: [todo("tight", "2026-11-19T21:00"), todo("roomy", "2026-11-21T12:00"), todo("booked", "2026-11-19T20:00", { event_id: "e1", scheduled_at: at("2026-11-19T19:00") })] }, now, tz);
  const by = Object.fromEntries([...g.today, ...g.week].map((x) => [x.title, x]));
  expect(by.tight.fit).toBeNull();
  expect(by.tight.note).toMatch(/no free time/);
  expect(by.roomy.fit?.start).toBe(new Date("2026-11-20T08:00:00+05:30").toISOString()); // tomorrow's first free hour
  expect(by.booked).toMatchObject({ fit: null, booked: at("2026-11-19T19:00").toISOString(), note: "On your calendar" });
});

test("the planner's suggestion rides on its to-do; email finds and other suggestions are their own items; most urgent first", () => {
  const sug = (id: string, kind: string, item: string | null, start: string) => ({ id, key: id, kind, item_id: item, title: id, reason: "new", from_calendar_id: null, from_event_id: null, from_start: null, to_start: at(start), to_end: at(start.replace(/T(\d\d)/, (_, h) => `T${String(+h + 1).padStart(2, "0")}`)) });
  const g = buildActions(
    {
      ...base,
      todos: [todo("essay", "2026-11-19T20:00")],
      suggestions: [sug("s1", "todo", "essay", "2026-11-19T15:00"), sug("gym", "routine", "r1", "2026-11-19T18:00")] as never,
      finds: [{ id: "f1", message_id: "m", thread_id: "t", kind: "call", title: "Call Priya", start_at: at("2026-11-19T16:00"), end_at: at("2026-11-19T16:15"), summary: "Wants a call", quote: "", sender: "Priya", account_email: null, pick_time: true, sender_email: null }],
      priorities: [{ key: "c:e", calendarId: "c", eventId: "e", title: "Exam", due: at("2026-11-19T17:00").toISOString(), allDay: false, severity: "critical", status: "open", reason: "Exam soon" }] as never,
    },
    now,
    tz,
  );
  expect(g.today.map((x) => x.title)).toEqual(["Exam", "Call Priya", "gym", "essay"]); // critical first, then by when (essay is due at 8 pm)
  const essay = g.today.find((x) => x.title === "essay")!;
  expect(essay.act).toEqual({ kind: "todo", id: "essay", suggestion: "s1" });
  expect(essay.fit?.start).toBe(at("2026-11-19T15:00").toISOString());
  // No time in the email: Almanac's suggested free time, which the card can change.
  expect(g.today.find((x) => x.title === "Call Priya")).toMatchObject({
    fit: { start: at("2026-11-19T16:00").toISOString() },
    act: { kind: "find", id: "f1", pickTime: true },
  });
});
