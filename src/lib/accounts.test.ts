import { randomBytes } from "node:crypto";
import { beforeAll, expect, test, vi } from "vitest";
import { linkDone, makeTicket, readTicket } from "./accounts";
import { oneEach, type Cal, type Ev } from "./calendar";

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

test("an add-account ticket says who and from where, and can't be changed or reused late", () => {
  const t = makeTicket("user-1", true);
  expect(readTicket(t)).toMatchObject({ uid: "user-1", app: true });
  expect(readTicket(t.slice(0, -4) + "AAAA")).toBeNull(); // tampered
  expect(readTicket("nonsense")).toBeNull();
  expect(readTicket(undefined)).toBeNull();
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 11 * 60_000);
  expect(readTicket(t)).toBeNull(); // expired
  vi.useRealTimers();
});

test("back from Google: the calendar on the website, a go-back page in the phone's browser", () => {
  expect(linkDone({ uid: "u", app: false, exp: 0 }, "added")).toBe("/?account=added");
  expect(linkDone({ uid: "u", app: true, exp: 0 }, "moved")).toBe("/api/link?done=moved");
});

const ev = (calendarId: string, extra: Partial<Ev> = {}): Ev => ({
  id: "x",
  calendarId,
  title: "Sync",
  start: "2026-11-20T10:00:00+05:30",
  end: "2026-11-20T11:00:00+05:30",
  allDay: false,
  busy: true,
  isOrganizer: false,
  ...extra,
});

test("a meeting on two of your calendars shows once, preferring the copy you organise", () => {
  const work = ev("work@x.com");
  const home = ev("me@gmail.com", { isOrganizer: true });
  expect(oneEach([["uid1", work], ["uid1", home]])).toEqual([home]);
  expect(oneEach([["uid1", home], ["uid1", work]])).toEqual([home]);
  // Neither organises it: the first calendar's copy.
  expect(oneEach([["uid1", work], ["uid1", ev("me@gmail.com")]])).toEqual([work]);
});

test("different meetings, occurrences of a repeating one, and events without a uid all stay", () => {
  const mon = ev("a", { originalStart: "2026-11-16T10:00:00+05:30" });
  const tue = ev("a", { originalStart: "2026-11-17T10:00:00+05:30" });
  expect(oneEach([["series", mon], ["series", tue]])).toHaveLength(2);
  expect(oneEach([["one", ev("a")], ["two", ev("b")]])).toHaveLength(2);
  expect(oneEach([[undefined, ev("a")], [undefined, ev("b")]])).toHaveLength(2);
});

test("where Almanac adds things: prep in the deadline's account, else the chosen calendar, else the main one", async () => {
  const { blockCalendar } = await import("./planner");
  const cal = (id: string, accountId: string, extra: Partial<Cal> = {}): Cal => ({
    id, accountId, account: `${accountId}@x.com`, name: id, color: "#000", primary: false, canEdit: true, defaultReminders: [], ...extra,
  });
  const cals = [
    cal("work", "a1", { primary: true }),
    cal("classes", "a1", { canEdit: false }),
    cal("home", "a2", { primary: true }),
    cal("family", "a2"),
  ];
  expect(blockCalendar(cals, null)?.id).toBe("work");
  expect(blockCalendar(cals, "family")?.id).toBe("family");
  expect(blockCalendar(cals, "classes")?.id).toBe("work"); // can't add to it
  expect(blockCalendar(cals, "family", "home:ev1")?.id).toBe("home");
  expect(blockCalendar(cals, "family", "classes:ev2")?.id).toBe("work"); // read-only deadline: its account's own calendar
  expect(blockCalendar([cal("ro", "a1", { canEdit: false })], null)).toBeUndefined();
});

test("a ticket can also ask for Gmail", () => {
  expect(readTicket(makeTicket("u", false, true))).toMatchObject({ gmail: true });
  expect(readTicket(makeTicket("u", false))).toMatchObject({ gmail: false });
});
