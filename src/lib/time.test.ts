process.env.TZ = "Asia/Kolkata";
import { describe, expect, test } from "vitest";
import { bookableWindow, endedToday, freeSlots, layoutColumns, overlapsDay, parseWhen, whenParts } from "./time";

const nov = (d: number, h = 0, m = 0) => new Date(2026, 10, d, h, m); // local IST
const ev = (start: string, end: string, extra: Partial<{ allDay: boolean; busy: boolean }> = {}) => ({
  start,
  end,
  allDay: false,
  busy: true,
  ...extra,
});
const ist = (d: number, hm: string) => `2026-11-${String(d).padStart(2, "0")}T${hm}:00+05:30`;
const show = (slots: { start: Date; end: Date }[]) =>
  slots.map((s) => `${s.start.getDate()} ${s.start.toTimeString().slice(0, 5)}-${s.end.getDate()} ${s.end.toTimeString().slice(0, 5)}`);

describe("day matching", () => {
  test("all-day dates are local midnight, not UTC", () => {
    expect(parseWhen("2026-11-03", true).getHours()).toBe(0);
    expect(parseWhen("2026-11-03", true).getDate()).toBe(3);
  });

  test("all-day event end is exclusive: shows on its day only", () => {
    const e = ev("2026-11-03", "2026-11-04", { allDay: true });
    expect(overlapsDay(e, nov(3))).toBe(true);
    expect(overlapsDay(e, nov(2))).toBe(false);
    expect(overlapsDay(e, nov(4))).toBe(false);
  });

  test("event crossing midnight IST shows on both days", () => {
    const e = ev(ist(3, "23:00"), ist(4, "01:00"));
    expect(overlapsDay(e, nov(3))).toBe(true);
    expect(overlapsDay(e, nov(4))).toBe(true);
    expect(overlapsDay(e, nov(5))).toBe(false);
  });

  test("event ending exactly at midnight does not spill into next day", () => {
    expect(overlapsDay(ev(ist(3, "22:00"), ist(4, "00:00")), nov(4))).toBe(false);
  });

  test("ended today: over since midnight, not still running, not all-day today, not earlier days", () => {
    const now = nov(3, 14);
    expect(endedToday(ev(ist(3, "10:00"), ist(3, "11:00")), now)).toBe(true);
    expect(endedToday(ev(ist(3, "13:00"), ist(3, "15:00")), now)).toBe(false); // still on
    expect(endedToday(ev(ist(3, "16:00"), ist(3, "17:00")), now)).toBe(false); // later today
    expect(endedToday(ev("2026-11-03", "2026-11-04", { allDay: true }), now)).toBe(false);
    expect(endedToday(ev(ist(2, "10:00"), ist(2, "11:00")), now)).toBe(false); // yesterday stays as a record
    expect(endedToday(ev("2026-11-02", "2026-11-03", { allDay: true }), now)).toBe(false);
  });

  test("UTC-written event lands on the right IST day", () => {
    // 20:00 UTC on 3 Nov = 01:30 IST on 4 Nov
    const e = ev("2026-11-03T20:00:00Z", "2026-11-03T21:00:00Z");
    expect(overlapsDay(e, nov(3))).toBe(false);
    expect(overlapsDay(e, nov(4))).toBe(true);
  });
});

describe("free slots", () => {
  test("empty day is one free slot", () => {
    expect(show(freeSlots([], nov(3, 8), nov(3, 22)))).toEqual(["3 08:00-3 22:00"]);
  });

  test("overlapping events merge into one busy block", () => {
    const events = [ev(ist(3, "09:00"), ist(3, "10:00")), ev(ist(3, "09:30"), ist(3, "11:00"))];
    expect(show(freeSlots(events, nov(3, 8), nov(3, 22)))).toEqual(["3 08:00-3 09:00", "3 11:00-3 22:00"]);
  });

  test("an event inside another doesn't shrink the busy block", () => {
    const events = [ev(ist(3, "09:00"), ist(3, "12:00")), ev(ist(3, "10:00"), ist(3, "10:30"))];
    expect(show(freeSlots(events, nov(3, 8), nov(3, 22)))).toEqual(["3 08:00-3 09:00", "3 12:00-3 22:00"]);
  });

  test("back-to-back events leave no zero-length gap", () => {
    const events = [ev(ist(3, "09:00"), ist(3, "10:00")), ev(ist(3, "10:00"), ist(3, "11:00"))];
    expect(show(freeSlots(events, nov(3, 8), nov(3, 22)))).toEqual(["3 08:00-3 09:00", "3 11:00-3 22:00"]);
  });

  test("gaps shorter than the minimum are ignored", () => {
    const events = [ev(ist(3, "09:00"), ist(3, "10:00")), ev(ist(3, "10:10"), ist(3, "11:00"))];
    expect(show(freeSlots(events, nov(3, 8), nov(3, 12), 15))).toEqual(["3 08:00-3 09:00", "3 11:00-3 12:00"]);
  });

  test("busy all-day event blocks the whole day", () => {
    expect(freeSlots([ev("2026-11-03", "2026-11-04", { allDay: true })], nov(3, 8), nov(3, 22))).toEqual([]);
  });

  test("holiday (all-day, shown as free) does not block", () => {
    const holiday = ev("2026-11-08", "2026-11-09", { allDay: true, busy: false });
    expect(show(freeSlots([holiday], nov(8, 8), nov(8, 22)))).toEqual(["8 08:00-8 22:00"]);
  });

  test("event from the night before blocks only until it ends after midnight", () => {
    const late = ev(ist(2, "23:00"), ist(3, "01:00"));
    expect(show(freeSlots([late], nov(3), nov(4)))).toEqual(["3 01:00-4 00:00"]);
  });

  test("event running into midnight frees the day until it starts", () => {
    const late = ev(ist(3, "23:00"), ist(4, "00:00"));
    expect(show(freeSlots([late], nov(3), nov(4)))).toEqual(["3 00:00-3 23:00"]);
  });

  test("UTC-written events block the right IST hours", () => {
    const e = ev("2026-11-03T03:30:00Z", "2026-11-03T04:30:00Z"); // 09:00–10:00 IST
    expect(show(freeSlots([e], nov(3, 8), nov(3, 12)))).toEqual(["3 08:00-3 09:00", "3 10:00-3 12:00"]);
  });
});

describe("bookable window", () => {
  test("today starts at now, rounded up to 15 minutes", () => {
    expect(bookableWindow(nov(3), nov(3, 13, 7))!.start).toEqual(nov(3, 13, 15));
  });
  test("a future day is bookable round the clock, midnight to midnight", () => {
    expect(bookableWindow(nov(4), nov(3, 13, 7))).toEqual({ start: nov(4), end: nov(5) });
  });
  test("late at night the rest of today is still bookable", () => {
    expect(bookableWindow(nov(3), nov(3, 22, 30))).toEqual({ start: nov(3, 22, 30), end: nov(4) });
    expect(bookableWindow(nov(3), nov(3, 23, 59))).toBeNull(); // rounds up to midnight: nothing left today
  });
});

describe("overlap layout", () => {
  test("overlapping events share columns; separate ones get full width", () => {
    const a = ev(ist(3, "09:00"), ist(3, "10:00"));
    const b = ev(ist(3, "09:30"), ist(3, "10:30"));
    const c = ev(ist(3, "11:00"), ist(3, "12:00"));
    const placed = layoutColumns([c, b, a]);
    const of = (e: typeof a) => placed.find((p) => p.event === e)!;
    expect([of(a).col, of(a).cols]).toEqual([0, 2]);
    expect([of(b).col, of(b).cols]).toEqual([1, 2]);
    expect([of(c).col, of(c).cols]).toEqual([0, 1]);
  });

  test("a column is reused once its event has ended", () => {
    const a = ev(ist(3, "09:00"), ist(3, "12:00"));
    const b = ev(ist(3, "09:00"), ist(3, "10:00"));
    const c = ev(ist(3, "10:00"), ist(3, "11:00"));
    const placed = layoutColumns([a, b, c]);
    expect(placed.map((p) => [p.col, p.cols])).toEqual([[0, 2], [1, 2], [1, 2]]);
  });
});

test("the dates and times in a sentence, for showing them bold", () => {
  const times = (s: string) => whenParts(s).filter((_, i) => i % 2);
  expect(times("Assignment submission due tomorrow night · in 2 days · sitting 1 of 2")).toEqual(["due tomorrow night", "in 2 days"]);
  expect(times("Overdue since Fri, 13 Nov · starts 5:00 pm")).toEqual(["Overdue", "Fri, 13 Nov", "5:00 pm"]);
  expect(times("Client pitch with the team")).toEqual([]);
});
