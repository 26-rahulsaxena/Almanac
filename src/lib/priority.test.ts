process.env.TZ = "Asia/Kolkata";
import { describe, expect, test } from "vitest";
import { byPriority, effective, isDeadline, laterOptions, latestSafe, suggest } from "./priority";

const now = new Date(2026, 10, 3, 14, 0); // Tue 3 Nov, 2 pm IST
const inHours = (h: number) => new Date(+now + h * 3_600_000);
const item = (title: string, description = "") => ({ calendarId: "me@gmail.com", title, description });

describe("what counts as a deadline", () => {
  test("deadline words in the title or notes", () => {
    expect(isDeadline(item("Marketing assignment due"), null)).toBe(true);
    expect(isDeadline(item("Team sync", "Submit slides before this"), null)).toBe(true);
    expect(isDeadline(item("Lunch with Aanya"), null)).toBe(false);
  });
  test("holidays never count, even with deadline-ish words", () => {
    expect(isDeadline({ calendarId: "en.indian#holiday@group.v.calendar.google.com", title: "Test holiday" }, null)).toBe(false);
  });
  test("your manual choice wins both ways", () => {
    expect(isDeadline(item("Lunch with Aanya"), true)).toBe(true);
    expect(isDeadline(item("Marketing assignment due"), false)).toBe(false);
  });
});

describe("suggested severity", () => {
  test("by time left", () => {
    expect(suggest(item("Assignment due"), inHours(18), now)).toEqual({ severity: "critical", reason: "Due in 18 h" });
    expect(suggest(item("Assignment due"), inHours(40), now).severity).toBe("high");
    expect(suggest(item("Assignment due"), inHours(100), now).severity).toBe("medium");
    expect(suggest(item("Assignment due"), inHours(130), now).severity).toBe("low");
  });
  test("big items go one level up and say why", () => {
    expect(suggest(item("Finance exam"), inHours(40), now)).toEqual({ severity: "critical", reason: "Due in 40 h · exam" });
    expect(suggest(item("Final submission"), inHours(100), now).severity).toBe("high");
  });
  test("small items go one level down", () => {
    expect(suggest(item("Practice quiz"), inHours(40), now).severity).toBe("medium");
  });
  test("long waits read in days", () => {
    expect(suggest(item("Report due"), inHours(100), now).reason).toBe("Due in 4 days");
  });
});

describe("effective severity", () => {
  test("every two Laters raise it one level, capped at critical", () => {
    expect(effective("medium", null, 1)).toBe("medium");
    expect(effective("medium", null, 2)).toBe("high");
    expect(effective("medium", null, 4)).toBe("critical");
    expect(effective("high", null, 9)).toBe("critical");
  });
  test("your choice always wins", () => {
    expect(effective("critical", "low", 4)).toBe("low");
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
    // Due 7 pm today → last safe start 5 pm → only "In 1 hour" (3 pm) and "In 3 hours" (5 pm).
    expect(laterOptions(now, inHours(5)).map((o) => o.label)).toEqual(["In 1 hour", "In 3 hours"]);
    expect(latestSafe(inHours(5))).toEqual(inHours(3));
  });
  test("no Later at all when the deadline is too close", () => {
    expect(laterOptions(now, inHours(2.5))).toEqual([]);
  });
});
