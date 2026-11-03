import { describe, expect, test } from "vitest";
import { describeReminder, dueReminders, midnightIn } from "./reminders";

const IST = "Asia/Kolkata";
const popup = (minutes: number) => ({ method: "popup", minutes });
const meeting = { start: "2026-11-04T10:00:00+05:30", allDay: false, reminders: [popup(10), popup(60)] };

describe("midnight in a time zone", () => {
  test("IST midnight is 18:30 UTC the day before", () => {
    expect(midnightIn("2026-11-04", IST).toISOString()).toBe("2026-11-03T18:30:00.000Z");
  });
  test("works for zones with daylight saving too", () => {
    expect(midnightIn("2026-07-01", "America/New_York").toISOString()).toBe("2026-07-01T04:00:00.000Z");
  });
});

describe("due reminders", () => {
  test("fires at exactly 10 minutes before (09:50 IST)", () => {
    expect(dueReminders(meeting, [], new Date("2026-11-04T04:20:00Z"), IST)).toEqual([
      { minutes: 10, fireAt: new Date("2026-11-04T04:20:00Z") },
    ]);
  });

  test("not yet due a minute early", () => {
    expect(dueReminders(meeting, [], new Date("2026-11-04T04:19:00Z"), IST)).toEqual([]);
  });

  test("a late minute job still catches it, but not forever", () => {
    expect(dueReminders(meeting, [], new Date("2026-11-04T04:25:00Z"), IST)).toHaveLength(1);
    expect(dueReminders(meeting, [], new Date("2026-11-04T04:31:00Z"), IST)).toEqual([]);
  });

  test("several reminders on one event fire separately", () => {
    expect(dueReminders(meeting, [], new Date("2026-11-04T03:30:00Z"), IST).map((d) => d.minutes)).toEqual([60]);
  });

  test("no reminders of its own → uses the calendar's defaults", () => {
    const e = { start: meeting.start, allDay: false };
    expect(dueReminders(e, [popup(30)], new Date("2026-11-04T04:00:00Z"), IST).map((d) => d.minutes)).toEqual([30]);
  });

  test("reminders turned off (empty list) never fire, even with calendar defaults", () => {
    const e = { start: meeting.start, allDay: false, reminders: [] };
    expect(dueReminders(e, [popup(30)], new Date("2026-11-04T04:00:00Z"), IST)).toEqual([]);
  });

  test("no reminders anywhere (e.g. a shared timetable calendar) → Almanac reminds 10 minutes before", () => {
    const e = { start: meeting.start, allDay: false };
    expect(dueReminders(e, [], new Date("2026-11-04T04:20:00Z"), IST).map((d) => d.minutes)).toEqual([10]);
    expect(dueReminders({ ...e, allDay: true, start: "2026-11-04" }, [], new Date("2026-11-03T18:30:00Z"), IST)).toEqual([]);
  });

  test("email reminders are left to Google", () => {
    const e = { ...meeting, reminders: [{ method: "email", minutes: 10 }] };
    expect(dueReminders(e, [], new Date("2026-11-04T04:20:00Z"), IST)).toEqual([]);
  });

  test("all-day: 'the day before at 9 am' fires at 09:00 IST the previous day", () => {
    const e = { start: "2026-11-08", allDay: true, reminders: [popup(900)] };
    const nineAmIst = new Date("2026-11-07T03:30:00Z");
    expect(dueReminders(e, [], nineAmIst, IST)).toEqual([{ minutes: 900, fireAt: nineAmIst }]);
  });
});

describe("reminder wording", () => {
  test("timed", () => {
    expect(describeReminder(10, false)).toBe("10 min before");
    expect(describeReminder(60, false)).toBe("1 hour before");
    expect(describeReminder(1440, false)).toBe("1 day before");
    expect(describeReminder(0, false)).toBe("At the start");
  });
  test("all-day", () => {
    expect(describeReminder(900, true)).toBe("The day before at 9:00 am");
    expect(describeReminder(0, true)).toBe("At midnight on the day");
  });
});
