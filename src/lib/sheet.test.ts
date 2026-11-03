// The server may run in UTC; sheet times must still mean the user's own clock (India here).
process.env.TZ = "UTC";
import { describe, expect, test } from "vitest";
import { parseDate, parseSheet, parseTime } from "./sheet";

const tz = "Asia/Kolkata";
const HEAD = ["Title", "Date", "Start", "End", "Location", "Notes"];
const parse = (...rows: (string | number | null)[][]) => parseSheet([HEAD, ...rows], tz);

describe("dates", () => {
  test("Sheets serial numbers, ISO, day-first text and month names", () => {
    expect(parseDate(46330)).toBe("2026-11-04"); // how Google Sheets stores 4 Nov 2026
    expect(parseDate("2026-11-04")).toBe("2026-11-04");
    expect(parseDate("4/11/2026")).toBe("2026-11-04");
    expect(parseDate("04-11-2026")).toBe("2026-11-04");
    expect(parseDate("4 Nov 2026")).toBe("2026-11-04");
    expect(parseDate("November 4, 2026")).toBe("2026-11-04");
  });
  test("nonsense is rejected, not guessed", () => {
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("next friday")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("times", () => {
  test("24-hour, am/pm and serial fractions", () => {
    expect(parseTime("9:00")).toBe(540);
    expect(parseTime("14:30")).toBe(870);
    expect(parseTime("2:30 pm")).toBe(870);
    expect(parseTime("9 am")).toBe(540);
    expect(parseTime("12 am")).toBe(0);
    expect(parseTime("12:15 PM")).toBe(735);
    expect(parseTime(0.375)).toBe(540); // 9:00 as Sheets stores it
  });
  test("impossible times are rejected", () => {
    expect(parseTime("25:00")).toBeNull();
    expect(parseTime("13 pm")).toBeNull();
    expect(parseTime("soon")).toBeNull();
  });
});

describe("rows into events", () => {
  test("a timed row uses the user's time zone, whatever the server's", () => {
    const { rows } = parse(["Study group", 46330, 0.4166666667, 0.5, "Library", "Bring notes"]);
    expect(rows).toEqual([
      { row: 2, title: "Study group", allDay: false, start: "2026-11-04T04:30:00.000Z", end: "2026-11-04T06:30:00.000Z", location: "Library", notes: "Bring notes" },
    ]);
  });
  test("no start means all day; no end means one hour; end before start runs past midnight", () => {
    const { rows } = parse(["Birthday", "2026-11-10", null, null], ["Call", "2026-11-04", "9:00", null], ["Night shift", "2026-11-04", "23:00", "1:00"]);
    expect(rows.map((r) => [r.allDay, r.start, r.end])).toEqual([
      [true, "2026-11-10", "2026-11-11"],
      [false, "2026-11-04T03:30:00.000Z", "2026-11-04T04:30:00.000Z"],
      [false, "2026-11-04T17:30:00.000Z", "2026-11-04T19:30:00.000Z"],
    ]);
  });
  test("bad rows are reported by row number and skipped; empty rows are ignored", () => {
    const { rows, problems } = parse([null, "2026-11-04", "9:00"], [], ["Exam", null], ["Exam", "someday"], ["Exam", "2026-11-04", "noonish"], ["Ok", "2026-11-04"]);
    expect(rows.map((r) => r.row)).toEqual([7]);
    expect(problems.map((p) => p.row)).toEqual([2, 4, 5, 6]);
    expect(problems[2].message).toContain("someday");
  });
  test("header names are matched loosely and columns can be in any order", () => {
    const { rows } = parseSheet([["Notes", "Time", "Task", "Day"], ["x", "10:00", "Gym", "2026-11-04"]], tz);
    expect(rows[0]).toMatchObject({ title: "Gym", notes: "x", start: "2026-11-04T04:30:00.000Z" });
  });
  test("a sheet without Title and Date columns says what's missing", () => {
    expect(parseSheet([["Foo", "Bar"]], tz).problems[0].message).toContain("Title and Date");
  });
});
