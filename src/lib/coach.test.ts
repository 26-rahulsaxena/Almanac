import { describe, expect, test } from "vitest";
import { clashFixes, dayPlan, weekReview, whatNow, workList, type Work } from "./coach";

const IST = "Asia/Kolkata";
const at = (local: string) => new Date(`${local}+05:30`);
const ev = (title: string, a: string, b: string, extra = {}) => ({ title, start: at(a).toISOString(), end: at(b).toISOString(), allDay: false, busy: true, ...extra });
const work = (title: string, minutes: number, severity: Work["severity"] = "medium"): Work => ({ key: title, title, minutes, due: null, severity, why: "Due soon" });

describe("what now", () => {
  const now = at("2026-11-04T14:00"); // Wednesday

  test("in the middle of something → stay with it", () => {
    const a = whatNow([ev("Class", "2026-11-04T13:30", "2026-11-04T15:00")], [work("Essay", 60)], now, IST);
    expect(a.state).toBe("busy");
    expect(a.headline).toContain("“Class” until 3:00 pm");
  });

  test("something starts within 20 minutes → get ready", () => {
    expect(whatNow([ev("Meeting", "2026-11-04T14:15", "2026-11-04T15:00")], [work("Essay", 60)], now, IST).state).toBe("soon");
  });

  test("late at night → rest", () => {
    expect(whatNow([], [work("Essay", 60)], at("2026-11-04T23:10"), IST).state).toBe("late");
  });

  test("free → the most important thing first, booked for as long as there's time", () => {
    const a = whatNow([ev("Meeting", "2026-11-04T15:30", "2026-11-04T16:00")], [work("Prep for exam", 120, "critical"), work("Email", 30, "low")], now, IST);
    expect(a.state).toBe("free");
    expect(a.headline).toBe("Do “Prep for exam” now.");
    expect(a.detail).toContain("free until 3:30 pm, then “Meeting” (1 h 30 min)");
    expect(a.picks.map((p) => [p.title, p.minutes])).toEqual([
      ["Prep for exam", 90], // 2 h job, 1 h 30 min free: make a start
      ["Email", 30],
    ]);
  });
});

describe("work list", () => {
  const now = at("2026-11-04T14:00");
  const todo = (t: object) => ({ id: "t", title: "Read notes", minutes: 60, due_at: null, done: false, event_id: null, ...t });
  const deadline = (p: object) => ({ key: "c:e", title: "Submit report", due: at("2026-11-05T10:00").toISOString(), severity: "critical" as const, reason: "Deadline · in 20 h", category: "deadline" as const, status: "open" as const, ...p });

  test("unbooked open to-dos and coming deadlines, most severe first", () => {
    const list = workList([todo({})], [deadline({})], now, IST);
    expect(list.map((w) => w.title)).toEqual(["Prepare for Submit report", "Read notes"]);
  });

  test("leaves out to-dos already booked or done, meetings, and deadlines marked done", () => {
    const list = workList([todo({ event_id: "x" }), todo({ done: true })], [deadline({ category: "work" }), deadline({ status: "done" })], now, IST);
    expect(list).toEqual([]);
  });

  test("an overdue to-do counts as high", () => {
    const [w] = workList([todo({ due_at: at("2026-11-03T10:00") })], [], now, IST);
    expect(w.severity).toBe("high");
    expect(w.why).toContain("Overdue");
  });
});

describe("today's plan", () => {
  test("the most important work that fits each free stretch", () => {
    const events = [ev("Class 1", "2026-11-04T09:00", "2026-11-04T10:30"), ev("Class 2", "2026-11-04T10:40", "2026-11-04T12:10")];
    const p = dayPlan(events, [work("Long essay", 120, "high"), work("Quick email", 30)], at("2026-11-04T08:00"), IST);
    expect(p.count).toBe(2);
    expect(p.first?.title).toBe("Class 1");
    expect(p.blocks.map((b) => [b.title, b.start])).toEqual([
      ["Quick email", at("2026-11-04T08:00").toISOString()], // only 1 h before the first class: the essay doesn't fit
      ["Long essay", at("2026-11-04T12:10").toISOString()],
    ]);
  });
});

describe("week in review", () => {
  test("time by kind of task, busiest day, deadlines", () => {
    const now = at("2026-11-08T20:00");
    const events = [
      ev("Team meeting", "2026-11-03T10:00", "2026-11-03T12:00"),
      ev("Gym", "2026-11-03T18:00", "2026-11-03T19:00"),
      ev("Project work", "2026-11-05T09:00", "2026-11-05T10:00"),
      ev("Old meeting", "2026-10-20T10:00", "2026-10-20T11:00"), // before the week: left out
      { ...ev("Holiday", "2026-11-04T00:00", "2026-11-05T00:00"), busy: false },
    ];
    const deadlines = [
      { title: "Submit report", due_at: at("2026-11-06T17:00"), status: "done" as const },
      { title: "Exam", due_at: at("2026-11-07T09:00"), status: "open" as const },
    ];
    const r = weekReview(events, ["Read notes"], deadlines, ["Pay bill"], now, IST);
    expect(r.totalMinutes).toBe(240);
    expect(r.byCategory).toEqual([
      { category: "work", label: "Work", minutes: 180 },
      { category: "leisure", label: "Leisure", minutes: 60 },
    ]);
    expect(r.busiestDay).toEqual({ day: "2026-11-03", minutes: 180 });
    expect(r.done).toEqual(["Read notes", "Submit report"]);
    expect(r.deadlines).toEqual({ met: 1, total: 2 });
    expect(r.unmarked).toEqual(["Exam"]);
    expect(r.overdue).toEqual(["Pay bill"]);
  });
});

describe("morning clash check", () => {
  const now = at("2026-11-04T08:00");
  const mine = (title: string, a: string, b: string, extra = {}) => ({ id: title, calendarId: "me", ...ev(title, a, b), ...extra });
  const editable = new Set(["me"]);
  const guests = { attendees: [{ self: true }, { email: "x@y.z" }] };

  test("the less important one moves to the nearest free time", () => {
    const events = [mine("Gym", "2026-11-04T18:00", "2026-11-04T19:00"), mine("Project review", "2026-11-04T18:30", "2026-11-04T19:30")];
    const [fix, ...more] = clashFixes(events, editable, now, IST);
    expect(more).toEqual([]);
    expect(fix.event.title).toBe("Gym");
    expect(fix.other.title).toBe("Project review");
    expect(fix.to.start).toEqual(at("2026-11-04T17:30")); // ends as the review starts: 30 min away, vs 90 after it
  });

  test("never moves events with guests, on calendars you can't edit, or Almanac's own blocks", () => {
    const meeting = mine("Gym", "2026-11-04T18:00", "2026-11-04T19:00", guests);
    const shared = mine("Class", "2026-11-04T18:30", "2026-11-04T19:30", { calendarId: "college" });
    const block = mine("Read notes", "2026-11-04T18:15", "2026-11-04T18:45", { plan: "todo:1" });
    expect(clashFixes([meeting, shared, block], editable, now, IST)).toEqual([]);
  });

  test("two fixes don't land on the same free time", () => {
    const events = [
      mine("Meeting", "2026-11-04T09:00", "2026-11-04T21:00", guests),
      mine("Gym", "2026-11-04T10:00", "2026-11-04T11:00"),
      mine("Walk", "2026-11-04T12:00", "2026-11-04T13:00"),
    ];
    const fixes = clashFixes(events, editable, now, IST);
    expect(fixes.map((f) => [f.event.title, f.to.start])).toEqual([
      ["Gym", at("2026-11-04T08:00")],
      ["Walk", at("2026-11-04T21:00")],
    ]);
  });
});
