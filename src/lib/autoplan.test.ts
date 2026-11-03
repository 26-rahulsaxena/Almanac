import { describe, expect, test } from "vitest";
import { autoPlan, type PlanRoutine, type PlanTodo } from "./autoplan";
import { ymdIn } from "./plan";

const IST = "Asia/Kolkata";
const at = (local: string) => new Date(`${local}+05:30`); // "2026-11-04T09:00" in India
const span = (a: string, b: string) => ({ start: at(a), end: at(b) });
const now = at("2026-11-04T09:00"); // a Wednesday
const todo = (t: Partial<PlanTodo>): PlanTodo => ({ id: "t", minutes: 60, due: null, group: null, block: null, ...t });
const day = (d: Date) => ymdIn(d, IST);

describe("to-dos", () => {
  test("goes in the first free stretch that fits, after what's already on", () => {
    const plan = autoPlan([span("2026-11-04T09:30", "2026-11-04T11:00")], [todo({})], [], now, IST);
    expect(plan.placements).toEqual([{ kind: "todo", id: "t", from: null, to: span("2026-11-04T11:00", "2026-11-04T12:00") }]);
  });

  test("a block that a new meeting now overlaps moves to free time", () => {
    const block = span("2026-11-04T14:00", "2026-11-04T15:00");
    const plan = autoPlan([span("2026-11-04T14:30", "2026-11-04T15:30")], [todo({ block })], [], now, IST);
    expect(plan.placements).toEqual([{ kind: "todo", id: "t", from: block, to: span("2026-11-04T09:15", "2026-11-04T10:15") }]);
  });

  test("a block with nothing in its way stays where it is", () => {
    const plan = autoPlan([], [todo({ block: span("2026-11-04T14:00", "2026-11-04T15:00") })], [], now, IST);
    expect(plan.placements).toEqual([]);
  });

  test("two of Almanac's blocks overlapping (one was made longer) → the second one moves", () => {
    const longer = span("2026-11-04T14:00", "2026-11-04T15:30");
    const next = span("2026-11-04T15:00", "2026-11-04T16:00");
    const plan = autoPlan([], [todo({ id: "a", block: longer }), todo({ id: "b", block: next })], [], now, IST);
    expect(plan.placements).toEqual([{ kind: "todo", id: "b", from: next, to: span("2026-11-04T09:15", "2026-11-04T10:15") }]);
  });

  test("more urgent to-dos get the earlier time", () => {
    const plan = autoPlan([], [todo({ id: "later", due: at("2026-11-08T12:00") }), todo({ id: "soon", due: at("2026-11-04T18:00") })], [], now, IST);
    expect(plan.placements.map((p) => p.id)).toEqual(["soon", "later"]);
  });

  test("parts of a split task land on different days", () => {
    const parts = [1, 2, 3].map((n) => todo({ id: `p${n}`, minutes: 120, group: "g", due: at("2026-11-08T12:00") }));
    const plan = autoPlan([], parts, [], now, IST);
    expect(plan.placements.map((p) => day(p.to.start))).toEqual(["2026-11-04", "2026-11-05", "2026-11-06"]);
  });

  test("no time before it's due → left for you to place", () => {
    const plan = autoPlan([span("2026-11-04T09:15", "2026-11-04T10:00")], [todo({ minutes: 120, due: at("2026-11-04T11:00") })], [], now, IST);
    expect(plan.unplaced).toEqual([{ kind: "todo", id: "t", from: null }]);
  });

  test("an unfinished to-do rolled over goes to the next day", () => {
    const block = span("2026-11-04T07:00", "2026-11-04T08:00");
    const plan = autoPlan([], [todo({ block, move: true, notBefore: at("2026-11-05T00:00") })], [], now, IST);
    expect(plan.placements).toEqual([{ kind: "todo", id: "t", from: block, to: span("2026-11-05T08:00", "2026-11-05T09:00") }]);
  });
});

describe("habits and focus time", () => {
  const gym: PlanRoutine = { id: "gym", minutes: 60, perWeek: 3, timeOfDay: "evening", blocks: [] };

  test("3 times a week, in the evening, spread over the rest of this week, and a fair share of next", () => {
    const plan = autoPlan([], [], [gym], now, IST);
    expect(plan.placements.map((p) => [day(p.to.start), p.to.start.toISOString()])).toEqual([
      ["2026-11-04", at("2026-11-04T17:00").toISOString()],
      ["2026-11-05", at("2026-11-05T17:00").toISOString()],
      ["2026-11-07", at("2026-11-07T17:00").toISOString()],
      ["2026-11-09", at("2026-11-09T17:00").toISOString()], // Monday: next week is only 2 days in view
    ]);
  });

  test("planning again straight after changes nothing", () => {
    const first = autoPlan([], [todo({})], [gym], now, IST);
    const again = autoPlan(
      [],
      [todo({ block: first.placements.find((p) => p.kind === "todo")!.to })],
      [{ ...gym, blocks: first.placements.filter((p) => p.kind === "routine").map((p) => p.to) }],
      now,
      IST,
    );
    expect(again).toEqual({ placements: [], unplaced: [] });
  });

  test("sessions already booked this week count, and aren't doubled", () => {
    const booked = [span("2026-11-02T18:00", "2026-11-02T19:00"), span("2026-11-03T18:00", "2026-11-03T19:00"), span("2026-11-05T18:00", "2026-11-05T19:00")];
    const plan = autoPlan([], [], [{ ...gym, blocks: booked }], now, IST);
    expect(plan.placements.map((p) => day(p.to.start))).toEqual(["2026-11-09"]);
  });

  test("a session a meeting now overlaps moves to another evening slot", () => {
    const block = span("2026-11-05T17:00", "2026-11-05T18:00");
    const plan = autoPlan([span("2026-11-05T16:30", "2026-11-05T18:30")], [], [{ ...gym, perWeek: 1, blocks: [block] }], now, IST);
    expect(plan.placements[0]).toEqual({ kind: "routine", id: "gym", from: block, to: span("2026-11-04T17:00", "2026-11-04T18:00") });
  });

  test("stays inside its time of day: busy evenings this week are skipped, not swapped for afternoons", () => {
    const busyEvenings = [4, 5, 6, 7, 8].map((d) => span(`2026-11-0${d}T17:00`, `2026-11-0${d}T22:00`));
    const plan = autoPlan(busyEvenings, [], [{ ...gym, perWeek: 1 }], now, IST);
    expect(plan.placements.map((p) => p.to)).toEqual([span("2026-11-09T17:00", "2026-11-09T18:00")]);
  });
});
