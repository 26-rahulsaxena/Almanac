import { expect, test } from "vitest";
import { parseDelete, parseSave } from "./validate";

const ok = {
  calendarId: "me@gmail.com",
  title: " Lunch ",
  allDay: false,
  start: "2026-11-10T06:30:00.000Z",
  end: "2026-11-10T07:30:00.000Z",
  timeZone: "Asia/Kolkata",
  colorId: "5",
  recurrence: "RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261231T182959Z",
};

test("accepts a normal event and trims the title", () => {
  expect(parseSave(ok)).toMatchObject({ title: "Lunch", colorId: "5", location: "" });
});

test("rejects bad input", () => {
  expect(() => parseSave({ ...ok, end: ok.start })).toThrow("End must be after start");
  expect(() => parseSave({ ...ok, start: "2026-11-10" })).toThrow("Invalid date");
  expect(() => parseSave({ ...ok, timeZone: "Mars/Base" })).toThrow("time zone");
  expect(() => parseSave({ ...ok, colorId: "12" })).toThrow("category");
  expect(() => parseSave({ ...ok, recurrence: "RRULE:FREQ=DAILY\r\nATTENDEE:x" })).toThrow("repeat rule");
  expect(() => parseSave({ ...ok, title: "x".repeat(301) })).toThrow("title");
  expect(() => parseSave("nope")).toThrow("Invalid request");
});

test("guests: emails checked, nothing sent unless explicitly 'all'", () => {
  const saved = parseSave({ ...ok, attendees: [{ email: " A@Example.com " }] });
  expect(saved.attendees).toEqual([{ email: "a@example.com", responseStatus: undefined }]);
  expect(saved.sendUpdates).toBe("none");
  expect(parseSave({ ...ok, sendUpdates: "yes please" }).sendUpdates).toBe("none");
  expect(parseSave({ ...ok, sendUpdates: "all" }).sendUpdates).toBe("all");
  expect(() => parseSave({ ...ok, attendees: [{ email: "not an email" }] })).toThrow("isn't an email");
  expect(() => parseSave({ ...ok, attendees: [{ email: "a@b.co", responseStatus: "maybe" }] })).toThrow("reply");
  expect(() => parseSave({ ...ok, attendees: Array(101).fill({ email: "a@b.co" }) })).toThrow("100");
});

test("editing an occurrence requires choosing which events", () => {
  expect(() => parseSave({ ...ok, id: "a_1", recurringEventId: "a", originalStart: ok.start })).toThrow("Choose which events");
  expect(() => parseDelete({ calendarId: "c", id: "a_1", recurringEventId: "a", originalStart: ok.start, scope: "everything" })).toThrow();
});
