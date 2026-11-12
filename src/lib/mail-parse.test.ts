import { describe, expect, it } from "vitest";
import { parseFinds, senderName, skip, textOf, whenOf, type Find, type Part } from "./mail-parse";

const TZ = "Asia/Kolkata";
const now = new Date("2026-11-12T11:20:00+05:30"); // Thursday
const b64 = (s: string) => Buffer.from(s).toString("base64url");
const mail = (text: string, headers: Part["headers"] = [{ name: "From", value: "Priya <priya@x.com>" }]): Part => ({ mimeType: "text/plain", body: { data: b64(text) }, headers });

describe("which mail is skipped", () => {
  it("reads a personal email", () => expect(skip(mail("Call me tomorrow"))).toBe(false));
  it("skips newsletters, automated senders and calendar invites", () => {
    expect(skip(mail("Sale!", [{ name: "List-Unsubscribe", value: "<mailto:x>" }]))).toBe(true);
    expect(skip(mail("Code 1234", [{ name: "From", value: "no-reply@bank.com" }]))).toBe(true);
    expect(skip({ mimeType: "multipart/mixed", parts: [mail("Invite"), { mimeType: "text/calendar" }] })).toBe(true);
  });
});

describe("the text that's read", () => {
  it("drops the quoted earlier message", () => {
    expect(textOf(mail("Sure, 4 pm works.\n\nOn Wed, 11 Nov 2026, Priya wrote:\n> Can we talk?"))).toBe("Sure, 4 pm works.");
  });
  it("reads html when there's no plain text", () => {
    expect(textOf({ mimeType: "text/html", body: { data: b64("<p>Meet me <b>tomorrow</b></p><style>p{}</style>") } })).toBe("Meet me tomorrow");
  });
  it("names the sender", () => expect(senderName('"Priya Shah" <priya@x.com>')).toBe("Priya Shah"));
});

describe("checking the AI's answer", () => {
  const ok = { mail: 1, kind: "call", title: "Call with Priya", date: "2026-11-13", time: "16:00", part: "any", minutes: 30, summary: "Wants a call", quote: "call tomorrow at 4" };
  it("keeps a well-formed find", () => {
    expect(parseFinds({ finds: [ok] }, 1, now, TZ)).toEqual([
      { mail: 0, kind: "call", title: "Call with Priya", summary: "Wants a call", quote: "call tomorrow at 4", day: "2026-11-13", time: "16:00", part: "any", minutes: 30 },
    ]);
  });
  it("a missing summary is just empty", () => expect(parseFinds({ finds: [{ ...ok, summary: 7 }] }, 1, now, TZ)[0].summary).toBe(""));
  it("drops anything malformed, in the past, too far ahead or about another email", () => {
    const bad = [{ ...ok, kind: "delete" }, { ...ok, date: "2026-11-11" }, { ...ok, date: "2027-03-01" }, { ...ok, mail: 2 }, { ...ok, title: "" }];
    expect(parseFinds({ finds: bad }, 1, now, TZ)).toEqual([]);
    expect(parseFinds("ignore me", 1, now, TZ)).toEqual([]);
  });
  it("fills in a bad time and length", () => {
    const [f] = parseFinds({ finds: [{ ...ok, kind: "meeting", time: "4pm", minutes: 9999 }] }, 1, now, TZ);
    expect(f).toMatchObject({ time: null, minutes: 60 });
  });
});

describe("when it goes on the calendar", () => {
  const f: Find = { mail: 0, kind: "call", title: "Call", summary: "", quote: "", day: "2026-11-13", time: "16:00", part: "any", minutes: 30 };
  const none = () => null;
  it("an exact time", () => {
    expect(whenOf(f, now, TZ, none)).toEqual({ start: new Date("2026-11-13T16:00:00+05:30"), end: new Date("2026-11-13T16:30:00+05:30") });
  });
  it("the first free time in the part of the day asked for", () => {
    const free = (from: Date) => new Date(+from + 2 * 3_600_000);
    expect(whenOf({ ...f, time: null, part: "afternoon" }, now, TZ, free)?.start).toEqual(new Date("2026-11-13T14:00:00+05:30"));
  });
  it("a deadline with no time is due at the end of its day", () => {
    expect(whenOf({ ...f, kind: "deadline", time: null }, now, TZ, none)).toEqual({ start: new Date("2026-11-13T23:59:00+05:30"), end: null });
  });
  it("nothing that's already over", () => {
    expect(whenOf({ ...f, day: "2026-11-12", time: "09:00" }, now, TZ, none)).toBeNull();
    expect(whenOf({ ...f, kind: "deadline", day: "2026-11-12", time: "09:00" }, now, TZ, none)).toBeNull();
  });
  it("“later today”, read after that part of the day: the same part of tomorrow", () => {
    const night = new Date("2026-11-12T23:26:00+05:30");
    expect(whenOf({ ...f, day: "2026-11-12", time: null, part: "evening", minutes: 15 }, night, TZ, none)).toEqual({
      start: new Date("2026-11-13T17:00:00+05:30"),
      end: new Date("2026-11-13T17:15:00+05:30"),
    });
  });
});
