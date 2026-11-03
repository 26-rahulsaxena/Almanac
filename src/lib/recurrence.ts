// Pure helpers for Google repeat rules (RRULE, RFC 5545) and for turning an edit into Google API calls.
// Google expands repeats itself; we only build rules and decide which event (one occurrence or the series) to change.

export type Scope = "this" | "following" | "all";
export type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type GTime = { date?: string | null; dateTime?: string | null; timeZone?: string };
export type Master = { start: GTime; end: GTime; recurrence?: string[]; conferenceData?: Record<string, unknown> };
export type Rsvp = "needsAction" | "accepted" | "declined" | "tentative";
export type Attendee = { email: string; responseStatus?: Rsvp; displayName?: string; self?: boolean; organizer?: boolean };
// "all" emails guests (invites, updates, cancellations). Anything else sends nothing.
export type SendUpdates = "all" | "none";

export type SaveInput = {
  calendarId: string;
  id?: string; // missing = new event
  recurringEventId?: string; // set when editing one occurrence of a series
  originalStart?: string; // that occurrence's original start (Google's originalStartTime)
  scope?: Scope;
  title: string;
  allDay: boolean;
  start: string; // "YYYY-MM-DD" when allDay, else ISO date-time
  end: string; // exclusive, same format
  timeZone: string;
  location: string;
  description: string;
  colorId: string | null;
  recurrence: string | null; // "RRULE:..." or null for no repeat
  attendees?: Attendee[]; // missing = leave the guest list as it is
  addMeet?: boolean;
  sendUpdates?: SendUpdates;
};
export type DeleteInput = Pick<SaveInput, "calendarId" | "recurringEventId" | "originalStart" | "scope" | "allDay" | "sendUpdates"> & {
  id: string;
};
export type Op = { method: "POST" | "PATCH" | "DELETE"; path: string; body?: Record<string, unknown> };

export type Repeat = {
  freq: Freq | null; // null = does not repeat
  interval: number;
  byDay: string[]; // weekly only: MO..SU
  ends: "never" | "until" | "count";
  until: string; // YYYY-MM-DD, inclusive, in the viewer's time zone
  count: number;
  raw?: string; // a rule with parts this app doesn't edit (e.g. "2nd Tuesday"), kept exactly as Google has it
};
export const NO_REPEAT: Repeat = { freq: null, interval: 1, byDay: [], ends: "never", until: "", count: 10 };

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR"];
export const dayCode = (d: Date) => DAY_CODES[d.getDay()];

const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// RRULE UNTIL format for timed events: "YYYYMMDDTHHMMSSZ".
const basicUtc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// Whole-day arithmetic on "YYYY-MM-DD" strings, unaffected by time zones.
export function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const daysBetween = (a: string, b: string) => Math.round((+new Date(`${b}T00:00:00Z`) - +new Date(`${a}T00:00:00Z`)) / 86_400_000);

function untilToDate(v: string) {
  if (/^\d{8}$/.test(v)) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  return m ? ymd(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))) : "";
}

export function parseRRule(line?: string | null): Repeat {
  if (!line) return NO_REPEAT;
  const parts: Record<string, string> = Object.fromEntries(
    line.replace(/^RRULE:/, "").split(";").map((p) => p.split("=") as [string, string]),
  );
  const r: Repeat = {
    freq: parts.FREQ as Freq,
    interval: Number(parts.INTERVAL ?? 1),
    byDay: parts.BYDAY ? parts.BYDAY.split(",") : [],
    ends: parts.UNTIL ? "until" : parts.COUNT ? "count" : "never",
    until: parts.UNTIL ? untilToDate(parts.UNTIL) : "",
    count: Number(parts.COUNT ?? 10),
  };
  const simple =
    Object.keys(parts).every((k) => ["FREQ", "INTERVAL", "BYDAY", "UNTIL", "COUNT", "WKST"].includes(k)) &&
    ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(parts.FREQ) &&
    r.byDay.every((d) => DAY_CODES.includes(d));
  return simple ? r : { ...r, raw: line };
}

export function toRRule(r: Repeat, allDay: boolean): string | null {
  if (r.raw) return r.raw;
  if (!r.freq) return null;
  const parts = [`FREQ=${r.freq}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.freq === "WEEKLY" && r.byDay.length) parts.push(`BYDAY=${r.byDay.join(",")}`);
  if (r.ends === "count") parts.push(`COUNT=${r.count}`);
  if (r.ends === "until" && r.until) {
    const [y, m, d] = r.until.split("-").map(Number);
    parts.push(`UNTIL=${allDay ? r.until.replaceAll("-", "") : basicUtc(new Date(y, m - 1, d, 23, 59, 59))}`);
  }
  return `RRULE:${parts.join(";")}`;
}

// The quick choices in the Repeat menu. "custom" uses the full Repeat editor.
export type Preset = "none" | "daily" | "weekly" | "weekdays" | "monthly" | "yearly" | "custom";

export function presetOf(r: Repeat, start: Date): Preset {
  if (r.raw) return "custom";
  if (!r.freq) return "none";
  if (r.interval !== 1 || r.ends !== "never") return "custom";
  const days = r.byDay.join(",");
  if (r.freq === "DAILY") return "daily";
  if (r.freq === "WEEKLY" && (days === "" || days === dayCode(start))) return "weekly";
  if (r.freq === "WEEKLY" && days === WEEKDAYS.join(",")) return "weekdays";
  if (r.freq === "MONTHLY") return "monthly";
  if (r.freq === "YEARLY") return "yearly";
  return "custom";
}

export function fromPreset(p: Preset, start: Date, custom: Repeat): Repeat {
  if (p === "custom") return custom;
  if (p === "none") return NO_REPEAT;
  if (p === "weekly") return { ...NO_REPEAT, freq: "WEEKLY", byDay: [dayCode(start)] };
  if (p === "weekdays") return { ...NO_REPEAT, freq: "WEEKLY", byDay: WEEKDAYS };
  return { ...NO_REPEAT, freq: p.toUpperCase() as Freq };
}

// Ends a series just before the given occurrence: drops COUNT/UNTIL and sets a new UNTIL.
export function untilBefore(rule: string, originalStart: string, allDay: boolean) {
  const kept = rule.replace(/^RRULE:/, "").split(";").filter((p) => !/^(UNTIL|COUNT)=/.test(p));
  const until = allDay ? shiftDate(originalStart, -1).replaceAll("-", "") : basicUtc(new Date(+new Date(originalStart) - 1000));
  return `RRULE:${[...kept, `UNTIL=${until}`].join(";")}`;
}

// Replaces the RRULE line, keeping Google's other lines (EXDATE for skipped dates, RDATE).
function withRule(recurrence: string[] = [], rule: string | null) {
  return [...recurrence.filter((l) => !l.startsWith("RRULE:")), ...(rule ? [rule] : [])];
}

const when = (v: string, allDay: boolean, timeZone: string): GTime =>
  allDay ? { date: v, dateTime: null } : { dateTime: v, timeZone, date: null };

function isFirst(m: Master, originalStart: string) {
  return m.start.date ? m.start.date === originalStart : +new Date(m.start.dateTime!) === +new Date(originalStart);
}

// New series start/end when "all events" are edited: shift the series by however much this occurrence moved.
function seriesTimes(m: Master, i: SaveInput) {
  const z = i.timeZone;
  // shortcut: switching a whole series between all-day and timed restarts it from this occurrence; earlier ones go. Handle via split if needed.
  if (!!m.start.date !== i.allDay || !i.originalStart) return { start: when(i.start, i.allDay, z), end: when(i.end, i.allDay, z) };
  if (i.allDay) {
    const start = shiftDate(m.start.date!, daysBetween(i.originalStart, i.start));
    return { start: when(start, true, z), end: when(shiftDate(start, daysBetween(i.start, i.end)), true, z) };
  }
  const s = new Date(+new Date(m.start.dateTime!) + (+new Date(i.start) - +new Date(i.originalStart)));
  const e = new Date(+s + (+new Date(i.end) - +new Date(i.start)));
  return { start: when(s.toISOString(), false, z), end: when(e.toISOString(), false, z) };
}

const enc = encodeURIComponent;

export function planSave(i: SaveInput, master?: Master, requestId: string = crypto.randomUUID()): Op[] {
  // Every call says explicitly whether Google may email guests; it never does unless the user chose "Send".
  const query = `?sendUpdates=${i.sendUpdates === "all" ? "all" : "none"}&conferenceDataVersion=1`;
  const list = `/calendars/${enc(i.calendarId)}/events`;
  const one = (id: string) => `${list}/${enc(id)}${query}`;
  const meet = { conferenceData: { createRequest: { requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } } };
  const fields = {
    summary: i.title,
    location: i.location,
    description: i.description,
    colorId: i.colorId,
    start: when(i.start, i.allDay, i.timeZone),
    end: when(i.end, i.allDay, i.timeZone),
    ...(i.attendees && { attendees: i.attendees.map(({ email, responseStatus }) => ({ email, responseStatus })) }),
    ...(i.addMeet && meet),
  };
  const rec = i.recurrence ? [i.recurrence] : undefined;

  if (!i.id) return [{ method: "POST", path: list + query, body: { ...fields, recurrence: rec } }];
  if (!i.recurringEventId) return [{ method: "PATCH", path: one(i.id), body: { ...fields, ...(rec && { recurrence: rec }) } }];
  if (i.scope === "this") return [{ method: "PATCH", path: one(i.id), body: fields }];
  if (!master || !i.originalStart) throw new Error("Series details missing");

  if (i.scope === "all" || isFirst(master, i.originalStart)) {
    return [
      {
        method: "PATCH",
        path: one(i.recurringEventId),
        body: { ...fields, ...seriesTimes(master, i), recurrence: withRule(master.recurrence, i.recurrence) },
      },
    ];
  }
  const rule = master.recurrence?.find((l) => l.startsWith("RRULE:"));
  if (!rule) throw new Error("Series has no repeat rule");
  // shortcut: a COUNT-limited series keeps its full COUNT in the new half, so it can run longer than before; compute remaining count if that matters.
  return [
    // New series first: if Google rejects it, the old series is still untouched. It keeps the same Meet link.
    { method: "POST", path: list + query, body: { conferenceData: master.conferenceData, ...fields, recurrence: rec } },
    { method: "PATCH", path: one(i.recurringEventId), body: { recurrence: withRule(master.recurrence, untilBefore(rule, i.originalStart, i.allDay)) } },
  ];
}

export function planDelete(i: DeleteInput, master?: Master): Op[] {
  const one = (id: string) => `/calendars/${enc(i.calendarId)}/events/${enc(id)}?sendUpdates=${i.sendUpdates === "all" ? "all" : "none"}`;
  if (!i.recurringEventId || i.scope === "this") return [{ method: "DELETE", path: one(i.id) }];
  if (!master || !i.originalStart) throw new Error("Series details missing");
  if (i.scope === "all" || isFirst(master, i.originalStart)) return [{ method: "DELETE", path: one(i.recurringEventId) }];
  const rule = master.recurrence?.find((l) => l.startsWith("RRULE:"));
  if (!rule) throw new Error("Series has no repeat rule");
  return [{ method: "PATCH", path: one(i.recurringEventId), body: { recurrence: withRule(master.recurrence, untilBefore(rule, i.originalStart, i.allDay)) } }];
}
