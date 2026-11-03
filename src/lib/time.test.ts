process.env.TZ = "Asia/Kolkata";
import { expect, test } from "vitest";
import { overlapsDay, parseWhen } from "./time";

const nov = (d: number) => new Date(2026, 10, d); // local IST midnight

test("all-day dates are local midnight, not UTC", () => {
  expect(parseWhen("2026-11-03", true).getHours()).toBe(0);
  expect(parseWhen("2026-11-03", true).getDate()).toBe(3);
});

test("all-day event ends exclusive: shows on its day only", () => {
  const e = { start: "2026-11-03", end: "2026-11-04", allDay: true };
  expect(overlapsDay(e, nov(3))).toBe(true);
  expect(overlapsDay(e, nov(2))).toBe(false);
  expect(overlapsDay(e, nov(4))).toBe(false);
});

test("event crossing midnight IST shows on both days", () => {
  const e = { start: "2026-11-03T23:00:00+05:30", end: "2026-11-04T01:00:00+05:30", allDay: false };
  expect(overlapsDay(e, nov(3))).toBe(true);
  expect(overlapsDay(e, nov(4))).toBe(true);
  expect(overlapsDay(e, nov(5))).toBe(false);
});

test("event ending exactly at midnight does not spill into next day", () => {
  const e = { start: "2026-11-03T22:00:00+05:30", end: "2026-11-04T00:00:00+05:30", allDay: false };
  expect(overlapsDay(e, nov(4))).toBe(false);
});

test("UTC-written event lands on the right IST day", () => {
  // 20:00 UTC on 3 Nov = 01:30 IST on 4 Nov
  const e = { start: "2026-11-03T20:00:00Z", end: "2026-11-03T21:00:00Z", allDay: false };
  expect(overlapsDay(e, nov(3))).toBe(false);
  expect(overlapsDay(e, nov(4))).toBe(true);
});
