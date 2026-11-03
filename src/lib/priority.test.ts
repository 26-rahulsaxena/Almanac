process.env.TZ = "Asia/Kolkata";
import { describe, expect, test } from "vitest";
import { byPriority, classify, effective, isTracked, laterOptions, latestSafe, suggest, titleKey } from "./priority";

const now = new Date(2026, 10, 3, 14, 0); // Tue 3 Nov, 2 pm IST
const inHours = (h: number) => new Date(+now + h * 3_600_000);
const item = (title: string, extra: { description?: string; busy?: boolean; guests?: number; calendarName?: string } = {}) => ({
  calendarId: "me@gmail.com",
  title,
  busy: true,
  ...extra,
});
const sev = (title: string, h: number, extra = {}) => suggest(item(title, extra), inHours(h), now).severity;

describe("kind of task", () => {
  test("deadline, work, personal, leisure from the words", () => {
    expect(classify(item("Finance exam")).category).toBe("deadline");
    expect(classify(item("Prepare for client meeting")).category).toBe("work");
    expect(classify(item("Dinner with Aanya")).category).toBe("personal");
    expect(classify(item("Gym")).category).toBe("leisure");
  });
  test("mixed titles: work beats personal, leisure beats personal", () => {
    expect(classify(item("Lunch meeting with client")).category).toBe("work");
    expect(classify(item("Gym with friends")).category).toBe("leisure");
  });
  test("the title wins over words in the notes; notes help when the title says nothing", () => {
    expect(classify(item("Gym workout", { description: "Bring the test results" })).category).toBe("leisure");
    expect(classify(item("Sunday", { description: "Exam revision" })).category).toBe("deadline");
  });
  test("no telling words: guests make it a meeting, a Family calendar makes it personal", () => {
    expect(classify(item("Catch-up with Priya", { guests: 2 })).category).toBe("work");
    expect(classify(item("Sunday plans", { calendarName: "Family" })).category).toBe("personal");
    expect(classify(item("Something")).category).toBe("other");
  });
});

describe("suggested severity: kind of task first, then time left", () => {
  test("same time, different kinds: gym < dinner < meeting prep < exam", () => {
    expect(sev("Gym", 5)).toBe("low");
    expect(sev("Dinner with Aanya", 5)).toBe("medium");
    expect(sev("Prepare for client meeting", 5)).toBe("high");
    expect(sev("Finance exam", 5)).toBe("critical");
  });
  test("further away drops a level (within 3 days) or two (beyond)", () => {
    expect(sev("Finance exam", 18)).toBe("critical");
    expect(sev("Finance exam", 60)).toBe("high");
    expect(sev("Finance exam", 100)).toBe("medium");
    expect(sev("Office report review", 60)).toBe("medium");
    expect(sev("Office report review", 100)).toBe("low");
  });
  test("small items go one level down", () => {
    expect(sev("Practice quiz", 5)).toBe("medium");
  });
  test("reason says the kind, the word and the time", () => {
    expect(suggest(item("Finance exam"), inHours(18), now).reason).toBe("Deadline · exam · in 18 h");
    expect(suggest(item("Gym"), inHours(5), now).reason).toBe("Leisure · gym · in 5 h");
    expect(suggest(item("Office report review"), inHours(100), now).reason).toBe("Work · office · in 4 days");
  });
});

describe("what appears in Priorities", () => {
  test("anything that blocks your time", () => {
    expect(isTracked(item("Gym"), null)).toBe(true);
  });
  test("free-time events only if they're deadlines or work (all-day 'Assignment due')", () => {
    expect(isTracked(item("Assignment due", { busy: false }), null)).toBe(true);
    expect(isTracked(item("Mom's birthday", { busy: false }), null)).toBe(false);
  });
  test("holidays never; your choice wins both ways", () => {
    expect(isTracked({ calendarId: "en.indian#holiday@group.v.calendar.google.com", title: "Diwali", busy: true }, null)).toBe(false);
    expect(isTracked(item("Mom's birthday", { busy: false }), true)).toBe(true);
    expect(isTracked(item("Finance exam"), false)).toBe(false);
  });
});

describe("your choice", () => {
  test("every two Laters raise the suggestion one level, capped at critical", () => {
    expect(effective("medium", null, 1)).toBe("medium");
    expect(effective("medium", null, 2)).toBe("high");
    expect(effective("high", null, 9)).toBe("critical");
  });
  test("your choice always wins", () => {
    expect(effective("critical", "low", 4)).toBe("low");
  });
  test("remembered by name, ignoring case, numbers and symbols", () => {
    expect(titleKey("Gym 💪")).toBe("gym");
    expect(titleKey("GYM - Day 3")).toBe("gym day");
    expect(titleKey("Gym")).toBe(titleKey("gym!"));
  });
});

test("sorting: open first, then severity, then soonest", () => {
  const list = [
    { id: "a", severity: "high" as const, status: "open" as const, due: inHours(30).toISOString() },
    { id: "b", severity: "critical" as const, status: "done" as const, due: inHours(2).toISOString() },
    { id: "c", severity: "high" as const, status: "later" as const, due: inHours(20).toISOString() },
    { id: "d", severity: "critical" as const, status: "open" as const, due: inHours(10).toISOString() },
  ];
  expect(list.sort(byPriority).map((x) => x.id)).toEqual(["d", "c", "a", "b"]);
});

describe("Later only offers safe times", () => {
  test("all options when the deadline is days away", () => {
    expect(laterOptions(now, inHours(72)).map((o) => o.label)).toEqual(["In 1 hour", "In 3 hours", "Tonight 8 pm", "Tomorrow 9 am"]);
  });
  test("nothing past 2 hours before the deadline", () => {
    expect(laterOptions(now, inHours(5)).map((o) => o.label)).toEqual(["In 1 hour", "In 3 hours"]);
    expect(latestSafe(inHours(5))).toEqual(inHours(3));
  });
  test("no Later at all when the deadline is too close", () => {
    expect(laterOptions(now, inHours(2.5))).toEqual([]);
  });
});
