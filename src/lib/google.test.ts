import { expect, test } from "vitest";
import { calendarIn } from "./google";

test("the calendar a Calendar API path is about decides the account", () => {
  expect(calendarIn("/calendars/me%40gmail.com/events?timeMin=x")).toBe("me@gmail.com");
  expect(calendarIn("/calendars/abc%40group.calendar.google.com/events/ev1")).toBe("abc@group.calendar.google.com");
  expect(calendarIn("/calendars/primary/events?sendUpdates=none")).toBe("primary"); // not saved, so the main account
  expect(calendarIn("/users/me/calendarList?fields=items(id)")).toBeUndefined();
});
