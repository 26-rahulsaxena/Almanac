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

test("editing an occurrence requires choosing which events", () => {
  expect(() => parseSave({ ...ok, id: "a_1", recurringEventId: "a", originalStart: ok.start })).toThrow("Choose which events");
  expect(() => parseDelete({ calendarId: "c", id: "a_1", recurringEventId: "a", originalStart: ok.start, scope: "everything" })).toThrow();
});
