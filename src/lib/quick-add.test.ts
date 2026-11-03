import { describe, expect, test } from "vitest";
import { quickAddPrompt, toProposal } from "./quick-add";

const IST = "Asia/Kolkata";
const now = new Date("2026-11-04T10:00:00+05:30"); // Wednesday

describe("quick add", () => {
  test("an event with a time and place", () => {
    const p = toProposal({ kind: "event", title: " Lunch with Riya ", start: "2026-11-06T13:00", minutes: 60, location: "the cafe" }, now, IST);
    expect(p).toEqual({ kind: "event", title: "Lunch with Riya", start: "2026-11-06T07:30:00.000Z", end: "2026-11-06T08:30:00.000Z", location: "the cafe" });
  });

  test("odd lengths fall back to an hour; a to-do's bad due date is dropped", () => {
    expect(toProposal({ kind: "todo", title: "Submit report", due: "next week", minutes: 9999 }, now, IST)).toEqual({ kind: "todo", title: "Submit report", due: null, minutes: 60 });
  });

  test("refuses no title, bad times and dates far away", () => {
    expect(() => toProposal({ kind: "event", title: "", start: "2026-11-06T13:00" }, now, IST)).toThrow();
    expect(() => toProposal({ kind: "event", title: "X", start: "Friday 1 pm" }, now, IST)).toThrow();
    expect(() => toProposal({ kind: "allday", title: "X", date: "2030-01-01" }, now, IST)).toThrow();
    expect(() => toProposal(null, now, IST)).toThrow();
  });

  test("the prompt lists the coming days by name", () => {
    expect(quickAddPrompt(now, IST)).toContain("Friday 2026-11-06");
    expect(quickAddPrompt(now, IST)).toContain("Wednesday 2026-11-04 (today)");
  });
});
