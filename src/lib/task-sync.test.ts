import { expect, test } from "vitest";
import { asTask, asTodo, signature } from "./task-sync";

const TZ = "Asia/Kolkata";

test("a to-do becomes a task on its day, with a real time kept apart and 'by that day' kept as none", () => {
  // 3:00 pm on 30 Nov in India
  expect(asTask({ title: "Pay rent", due_at: new Date("2026-11-30T09:30:00Z"), done: false }, TZ)).toEqual({
    fields: { title: "Pay rent", due: "2026-11-30T00:00:00.000Z", status: "needsAction", completed: null },
    minutes: 15 * 60,
  });
  // "by Friday" is saved as 23:59, and 1:30 am on 1 Dec in India is still 30 Nov in UTC
  expect(asTask({ title: "x", due_at: new Date("2026-11-30T18:29:00Z"), done: true }, TZ)).toMatchObject({ fields: { due: "2026-11-30T00:00:00.000Z", status: "completed" }, minutes: null });
  expect(asTask({ title: "x", due_at: new Date("2026-11-30T20:00:00Z"), done: false }, TZ).fields.due).toBe("2026-12-01T00:00:00.000Z");
  expect(asTask({ title: "x", due_at: null, done: false }, TZ)).toMatchObject({ fields: { due: null }, minutes: null });
});

test("a task becomes a to-do due by the end of its day, or at the time Almanac kept", () => {
  expect(asTodo({ title: "Pay rent", due: "2026-11-30T00:00:00.000Z" }, undefined, TZ)).toEqual({ title: "Pay rent", due_at: new Date("2026-11-30T18:29:00Z"), done: false });
  expect(asTodo({ due: "2026-11-30T00:00:00.000Z", status: "completed" }, { minutes: 15 * 60, time_zone: TZ }, TZ)).toEqual({
    title: "(No title)",
    due_at: new Date("2026-11-30T09:30:00Z"),
    done: true,
  });
  expect(asTodo({ title: "Someday" }, undefined, TZ).due_at).toBeNull();
});

test("a to-do read from a task keeps its signature, and any change to title, day, done or time changes it", () => {
  const r = asTodo({ title: "Pay rent", due: "2026-11-30T00:00:00.000Z" }, undefined, TZ);
  const sig = signature(r, TZ);
  expect(signature({ ...r }, TZ)).toBe(sig);
  expect(signature({ ...r, title: "Pay rent today" }, TZ)).not.toBe(sig);
  expect(signature({ ...r, done: true }, TZ)).not.toBe(sig);
  expect(signature({ ...r, due_at: new Date("2026-12-01T18:29:00Z") }, TZ)).not.toBe(sig);
  expect(signature({ ...r, due_at: new Date("2026-11-30T09:30:00Z") }, TZ)).not.toBe(sig); // same day, now at 3 pm
});
