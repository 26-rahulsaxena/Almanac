// The server may run in UTC; planning must still follow the user's zone (India here).
process.env.TZ = "UTC";
import { describe, expect, test } from "vitest";
import { freeByDay, fromLocal, pickSlot, toLocal } from "./plan";

const tz = "Asia/Kolkata";
const at = (s: string) => fromLocal(s, tz)!;
const ev = (start: string, end: string, busy = true) => ({ start: at(start).toISOString(), end: at(end).toISOString(), allDay: false, busy });
const show = (s: { start: Date; end: Date }) => `${toLocal(s.start, tz)}-${toLocal(s.end, tz).slice(11)}`;

test("local wall-clock times round-trip through the user's zone", () => {
  expect(at("2026-11-04T15:30").toISOString()).toBe("2026-11-04T10:00:00.000Z");
  expect(toLocal(new Date("2026-11-04T18:45:00Z"), tz)).toBe("2026-11-05T00:15");
  expect(fromLocal("2026-11-04T25:00", tz)).toBeNull();
  expect(fromLocal("tomorrow 3pm", tz)).toBeNull();
});

describe("free time per day", () => {
  test("8 am–10 pm in India, around busy events, never before now", () => {
    const days = freeByDay([ev("2026-11-03T15:00", "2026-11-03T16:00")], at("2026-11-03T13:10"), tz, 2);
    expect(days[0].day).toBe("2026-11-03");
    expect(days[0].slots.map(show)).toEqual(["2026-11-03T13:15-15:00", "2026-11-03T16:00-22:00"]);
    expect(days[1].slots.map(show)).toEqual(["2026-11-04T08:00-22:00"]);
  });
  test("an all-day busy event blocks that whole day in India, whatever the server's zone", () => {
    const allDay = { start: "2026-11-04", end: "2026-11-05", allDay: true, busy: true };
    expect(freeByDay([allDay], at("2026-11-03T21:00"), tz, 2)[1].slots).toEqual([]);
  });
  test("events marked free don't block", () => {
    expect(freeByDay([ev("2026-11-04T09:00", "2026-11-04T21:00", false)], at("2026-11-04T07:00"), tz, 1)[0].slots.map(show)).toEqual([
      "2026-11-04T08:00-22:00",
    ]);
  });
});

describe("first slot for a task", () => {
  const busy = [ev("2026-11-03T13:00", "2026-11-03T21:30")];
  test("skips gaps that are too short and moves to the next morning", () => {
    expect(show(pickSlot(busy, at("2026-11-03T12:30"), tz, 60)!)).toBe("2026-11-04T08:00-09:00");
    expect(show(pickSlot(busy, at("2026-11-03T12:30"), tz, 30)!)).toBe("2026-11-03T12:30-13:00");
    expect(show(pickSlot(busy, at("2026-11-03T12:45"), tz, 30)!)).toBe("2026-11-03T21:30-22:00");
  });
  test("nothing if it can't finish before it's due", () => {
    expect(pickSlot(busy, at("2026-11-03T12:30"), tz, 60, at("2026-11-04T08:30"))).toBeNull();
    expect(show(pickSlot(busy, at("2026-11-03T12:30"), tz, 60, at("2026-11-04T09:00"))!)).toBe("2026-11-04T08:00-09:00");
  });
});
