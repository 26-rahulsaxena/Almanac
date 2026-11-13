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

test("unbooked to-dos are listed as to-dos, with or without a due date", () => {
  const todos: RateItem[] = [
    { key: "todo:1", title: "Read notes", due: "", end: null, allDay: false, deadline: false, guests: 0, todo: { minutes: 90 } },
    { key: "todo:2", title: "Pay bill", due: "2026-11-05T04:30:00.000Z", end: null, allDay: false, deadline: false, guests: 0, todo: { minutes: 15 } },
  ];
  expect(ratingList(todos, IST)).toBe(`1. "Read notes" · to-do, takes 1 h 30 min · no due date\n2. "Pay bill" · to-do, takes 15 min · due Thu, 5 Nov 10:00 am`);
});

test("prep estimates: only on deadlines, in quarter hours up to 12 h, 1–5 sittings of at least 15 min", () => {
  const prep = (r: object, i = 1) => parseRatings({ ratings: [{ id: i, level: "high", why: "Big exam", ...r }] }, items)[0];
  expect(prep({ prep: 170, sessions: 3 }, 2)).toMatchObject({ prep: 165, sessions: 3 });
  expect(prep({ prep: 5000, sessions: 9 }, 2)).toMatchObject({ prep: 720, sessions: 5 });
  expect(prep({ prep: 15, sessions: 4 }, 2)).toMatchObject({ prep: 15, sessions: 1 });
  expect(prep({ prep: 0 }, 2)).toMatchObject({ prep: 0 });
  expect(prep({ prep: "lots" }, 2).prep).toBeUndefined();
  expect(prep({ prep: 120, sessions: 2 }, 1).prep).toBeUndefined(); // item 1 isn't a deadline
});

test("the AI is told about the person only when they filled it in", () => {
  const now = new Date("2026-11-04T05:00:00Z");
  expect(ratingPrompt(now, IST, "Teacher / faculty. Cares most about: exams.")).toContain("About this person (what they told the app about their work; weigh items by it): Teacher / faculty. Cares most about: exams.");
  expect(ratingPrompt(now, IST)).not.toContain("About this person");
});
