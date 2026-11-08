import { expect, test } from "vitest";
import { parseRatings, ratingList, ratingPrompt, type RateItem } from "./ai-priority";

const IST = "Asia/Kolkata";
const items: RateItem[] = [
  { key: "c:1", title: "Prepare client presentation", due: "2026-11-04T06:30:00.000Z", end: "2026-11-04T08:29:00.000Z", allDay: false, deadline: false, guests: 0 },
  { key: "c:2", title: 'Marketing "final" exam', due: "2026-11-05T04:30:00.000Z", end: null, allDay: false, deadline: true, guests: 3, calendar: "College" },
];

test("the list the AI reads: times in the user's zone, guests, calendar; quotes can't break out", () => {
  expect(ratingList(items, IST)).toBe(
    [
      `1. "Prepare client presentation" · starts Wed, 4 Nov 12:00 pm–1:59 pm`,
      `2. "Marketing 'final' exam" · due Thu, 5 Nov 10:00 am · with 3 other people · calendar "College"`,
    ].join("\n"),
  );
});

test("only known ids and levels are kept, with short one-line reasons", () => {
  const raw = {
    ratings: [
      { id: 1, level: "critical", why: "Client work starting\nvery soon. " },
      { id: 2, level: "high", why: "Exam tomorrow; prepare tonight" },
      { id: 3, level: "low", why: "No such item" },
      { id: 1, level: "urgent!!", why: "Unknown level" },
      { id: 2, level: "low", why: "" },
      { id: "1", level: "low", why: "Id must be a number" },
    ],
  };
  expect(parseRatings(raw, items)).toEqual([
    { key: "c:1", due: items[0].due, severity: "critical", reason: "Client work starting very soon" },
    { key: "c:2", due: items[1].due, severity: "high", reason: "Exam tomorrow; prepare tonight" },
  ]);
  expect(parseRatings({ ratings: [{ id: 1, level: "low", why: "x".repeat(300) }] }, items)[0].reason).toHaveLength(100);
  expect(parseRatings(null, items)).toEqual([]);
  expect(parseRatings({ ratings: "nope" }, items)).toEqual([]);
});

test("the AI is told about the person only when they filled it in", () => {
  const now = new Date("2026-11-04T05:00:00Z");
  expect(ratingPrompt(now, IST, "Teacher / faculty. Cares most about: exams.")).toContain("About this person (what they told the app about their work; weigh items by it): Teacher / faculty. Cares most about: exams.");
  expect(ratingPrompt(now, IST)).not.toContain("About this person");
});
