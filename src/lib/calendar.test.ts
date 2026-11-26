import { expect, test } from "vitest";
import { taskEvent } from "./calendar";
import { isTracked } from "./priority";

test("a Google Task is an all-day event on its due date, and always a priority", () => {
  const e = taskEvent({ id: "t1", title: "Pay rent", notes: "online", due: "2026-11-30T00:00:00.000Z" }, "L1", "tasks~a1");
  expect(e).toMatchObject({ id: "L1~t1", calendarId: "tasks~a1", title: "Pay rent", start: "2026-11-30", end: "2026-12-01", allDay: true, busy: false, description: "online" });
  expect(taskEvent({ id: "t2", due: "2026-12-31T00:00:00.000Z" }, "L1", "tasks~a1")).toMatchObject({ title: "(No title)", end: "2027-01-01" });
  expect(e.done).toBeUndefined();
  expect(taskEvent({ id: "t3", due: "2026-11-30T00:00:00.000Z", status: "completed" }, "L1", "tasks~a1").done).toBe(true);
  expect(isTracked({ ...e, busy: false }, null)).toBe(true);
});
