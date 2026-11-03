process.env.TZ = "Asia/Kolkata";
import { describe, expect, test } from "vitest";
import {
  fromPreset,
  NO_REPEAT,
  parseRRule,
  planDelete,
  planSave,
  presetOf,
  toRRule,
  untilBefore,
  type Master,
  type SaveInput,
} from "./recurrence";

const base: SaveInput = {
  calendarId: "me@gmail.com",
  title: "Standup",
  allDay: false,
  start: "2026-11-10T04:30:00.000Z", // 10:00 IST
  end: "2026-11-10T05:30:00.000Z",
  timeZone: "Asia/Kolkata",
  location: "",
  description: "",
  colorId: null,
  recurrence: "RRULE:FREQ=WEEKLY;BYDAY=TU",
};

// Weekly series on Tuesdays 09:00–10:00 IST from 3 Nov, with one skipped date.
const master: Master = {
  start: { dateTime: "2026-11-03T09:00:00+05:30", timeZone: "Asia/Kolkata" },
  end: { dateTime: "2026-11-03T10:00:00+05:30", timeZone: "Asia/Kolkata" },
  recurrence: ["EXDATE;TZID=Asia/Kolkata:20261117T090000", "RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=10"],
  conferenceData: { conferenceId: "abc-defg-hij" },
};
// The 10 Nov occurrence, moved from 09:00 to 10:00.
const occurrence = { id: "abc_20261110T033000Z", recurringEventId: "abc", originalStart: "2026-11-10T09:00:00+05:30" };

const EVENTS = "/calendars/me%40gmail.com/events";
const NO_EMAIL = "?sendUpdates=none&conferenceDataVersion=1";

describe("repeat rules", () => {
  test("weekly preset uses the start date's weekday", () => {
    const tue = new Date(2026, 10, 10);
    expect(toRRule(fromPreset("weekly", tue, NO_REPEAT), false)).toBe("RRULE:FREQ=WEEKLY;BYDAY=TU");
    expect(toRRule(fromPreset("weekdays", tue, NO_REPEAT), false)).toBe("RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(toRRule(fromPreset("none", tue, NO_REPEAT), false)).toBeNull();
  });

  test("custom rule with interval and end date (timed: end of that day IST, in UTC)", () => {
    const r = { ...NO_REPEAT, freq: "WEEKLY" as const, interval: 2, byDay: ["MO", "WE"], ends: "until" as const, until: "2026-12-31" };
    expect(toRRule(r, false)).toBe("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261231T182959Z");
    expect(toRRule(r, true)).toBe("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261231");
  });

  test("parse round-trips and maps back to the quick choice", () => {
    const r = parseRRule("RRULE:FREQ=WEEKLY;BYDAY=TU");
    expect(presetOf(r, new Date(2026, 10, 10))).toBe("weekly");
    expect(parseRRule("RRULE:FREQ=DAILY;COUNT=5")).toMatchObject({ freq: "DAILY", ends: "count", count: 5 });
    expect(parseRRule("RRULE:FREQ=WEEKLY;UNTIL=20261231T182959Z").until).toBe("2026-12-31");
  });

  test("rules this app can't edit are kept exactly", () => {
    const raw = "RRULE:FREQ=MONTHLY;BYDAY=2TU";
    const r = parseRRule(raw);
    expect(r.raw).toBe(raw);
    expect(presetOf(r, new Date())).toBe("custom");
    expect(toRRule(r, false)).toBe(raw);
  });

  test("ending a series before an occurrence drops COUNT and sets UNTIL one second earlier", () => {
    expect(untilBefore("RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=10", "2026-11-10T09:00:00+05:30", false)).toBe(
      "RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261110T032959Z",
    );
    expect(untilBefore("RRULE:FREQ=DAILY;UNTIL=20270101", "2026-11-10", true)).toBe("RRULE:FREQ=DAILY;UNTIL=20261109");
  });
});

describe("saving", () => {
  test("new repeating event is one insert with the rule", () => {
    expect(planSave(base)).toEqual([
      {
        method: "POST",
        path: EVENTS + NO_EMAIL,
        body: expect.objectContaining({ summary: "Standup", recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU"] }),
      },
    ]);
  });

  test("new single event has no recurrence", () => {
    expect(planSave({ ...base, recurrence: null })[0].body!.recurrence).toBeUndefined();
  });

  test("this event only: patches just that occurrence, never the rule", () => {
    const [op, ...rest] = planSave({ ...base, ...occurrence, scope: "this" }, master);
    expect(rest).toEqual([]);
    expect(op.method).toBe("PATCH");
    expect(op.path).toBe(`${EVENTS}/abc_20261110T033000Z${NO_EMAIL}`);
    expect(op.body).not.toHaveProperty("recurrence");
  });

  test("all events: moves the whole series by the same hour and keeps skipped dates", () => {
    const [op, ...rest] = planSave({ ...base, ...occurrence, scope: "all" }, master);
    expect(rest).toEqual([]);
    expect(op.path).toBe(`${EVENTS}/abc${NO_EMAIL}`);
    expect(op.body!.start).toEqual({ dateTime: "2026-11-03T04:30:00.000Z", timeZone: "Asia/Kolkata", date: null }); // 10:00 IST
    expect(op.body!.end).toEqual({ dateTime: "2026-11-03T05:30:00.000Z", timeZone: "Asia/Kolkata", date: null });
    expect(op.body!.recurrence).toEqual(["EXDATE;TZID=Asia/Kolkata:20261117T090000", "RRULE:FREQ=WEEKLY;BYDAY=TU"]);
  });

  test("this and following: creates the new series first (same Meet link), then ends the old one before it", () => {
    const ops = planSave({ ...base, ...occurrence, scope: "following" }, master);
    expect(ops.map((o) => `${o.method} ${o.path}`)).toEqual([`POST ${EVENTS}${NO_EMAIL}`, `PATCH ${EVENTS}/abc${NO_EMAIL}`]);
    expect(ops[0].body!.start).toEqual({ dateTime: base.start, timeZone: "Asia/Kolkata", date: null });
    expect(ops[0].body!.conferenceData).toEqual({ conferenceId: "abc-defg-hij" });
    expect(ops[1].body).toEqual({
      recurrence: ["EXDATE;TZID=Asia/Kolkata:20261117T090000", "RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261110T032959Z"],
    });
  });

  test("this and following on the first occurrence is the same as all events", () => {
    const first = { ...occurrence, id: "abc_20261103T033000Z", originalStart: "2026-11-03T09:00:00+05:30" };
    const ops = planSave({ ...base, ...first, start: "2026-11-03T04:30:00.000Z", end: "2026-11-03T05:30:00.000Z", scope: "following" }, master);
    expect(ops).toHaveLength(1);
    expect(ops[0].path).toBe(`${EVENTS}/abc${NO_EMAIL}`);
  });

  test("all-day series moved by a day shifts the series start by a day", () => {
    const m: Master = { start: { date: "2026-11-02" }, end: { date: "2026-11-03" }, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"] };
    const [op] = planSave(
      { ...base, allDay: true, start: "2026-11-10", end: "2026-11-11", id: "x_20261109", recurringEventId: "x", originalStart: "2026-11-09", scope: "all", recurrence: "RRULE:FREQ=WEEKLY;BYDAY=TU" },
      m,
    );
    expect(op.body!.start).toEqual({ date: "2026-11-03", dateTime: null });
    expect(op.body!.end).toEqual({ date: "2026-11-04", dateTime: null });
  });
});

describe("guests and Meet", () => {
  const guests = [{ email: "a@example.com" }, { email: "b@example.com", responseStatus: "accepted" as const, displayName: "B" }];

  test("guests are saved but nobody is emailed unless the user chose to send", () => {
    const [op] = planSave({ ...base, attendees: guests });
    expect(op.path).toContain("sendUpdates=none");
    expect(op.body!.attendees).toEqual([
      { email: "a@example.com", responseStatus: undefined },
      { email: "b@example.com", responseStatus: "accepted" }, // keeps existing replies
    ]);
  });

  test("choosing Send emails the guests", () => {
    expect(planSave({ ...base, attendees: guests, sendUpdates: "all" })[0].path).toContain("sendUpdates=all");
  });

  test("leaving the guest list alone doesn't touch it", () => {
    expect(planSave({ ...base, id: "solo" })[0].body).not.toHaveProperty("attendees");
  });

  test("one click adds a Google Meet request", () => {
    const [op] = planSave({ ...base, addMeet: true }, undefined, "req-1");
    expect(op.body!.conferenceData).toEqual({ createRequest: { requestId: "req-1", conferenceSolutionKey: { type: "hangoutsMeet" } } });
    expect(op.path).toContain("conferenceDataVersion=1");
  });
});

describe("deleting", () => {
  const del = { calendarId: "me@gmail.com", allDay: false, ...occurrence };

  test("single event, no cancellation emails by default", () => {
    expect(planDelete({ calendarId: "me@gmail.com", allDay: false, id: "solo" })).toEqual([
      { method: "DELETE", path: `${EVENTS}/solo?sendUpdates=none` },
    ]);
  });
  test("cancellation emails only when chosen", () => {
    expect(planDelete({ calendarId: "me@gmail.com", allDay: false, id: "solo", sendUpdates: "all" })[0].path).toBe(`${EVENTS}/solo?sendUpdates=all`);
  });
  test("this occurrence only", () => {
    expect(planDelete({ ...del, scope: "this" })).toEqual([{ method: "DELETE", path: `${EVENTS}/abc_20261110T033000Z?sendUpdates=none` }]);
  });
  test("all events deletes the series", () => {
    expect(planDelete({ ...del, scope: "all" }, master)).toEqual([{ method: "DELETE", path: `${EVENTS}/abc?sendUpdates=none` }]);
  });
  test("this and following ends the series before it, deleting nothing else", () => {
    expect(planDelete({ ...del, scope: "following" }, master)).toEqual([
      {
        method: "PATCH",
        path: `${EVENTS}/abc?sendUpdates=none`,
        body: { recurrence: ["EXDATE;TZID=Asia/Kolkata:20261117T090000", "RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261110T032959Z"] },
      },
    ]);
  });
});
