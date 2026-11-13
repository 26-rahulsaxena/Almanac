// Date helpers that run in the browser, so "local" means the viewer's own time zone.

type Timed = { start: string; end: string; allDay: boolean };
type Busy = Timed & { busy: boolean };
export type Interval = { start: Date; end: Date };

// Waking hours, used only to count and suggest free time (booking works at any hour).
// shortcut: 8 am–10 pm for everyone; make these per-user settings when someone keeps different hours.
export const FREE_FROM_HOUR = 8;
export const FREE_TO_HOUR = 22;

// All-day dates ("2026-11-03") mean local midnight, not UTC midnight.
export function parseWhen(s: string, allDay: boolean) {
  if (!allDay) return new Date(s);
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function startOfDay(d: Date) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

// Weeks start on Monday.
export function startOfWeek(d: Date) {
  const r = startOfDay(d);
  return addDays(r, -((r.getDay() + 6) % 7));
}

export function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function atHour(day: Date, hour: number) {
  const r = startOfDay(day);
  r.setHours(hour);
  return r;
}

// How the viewer answered an invite, shown on event blocks. Events without guests have no answer.
export function myReply(e: { attendees?: { self?: boolean; responseStatus?: string }[] }) {
  const s = e.attendees?.find((a) => a.self)?.responseStatus;
  if (s === "declined") return { className: "line-through opacity-60", note: " · you declined", dashed: false };
  if (s === "needsAction") return { className: "", note: " · not answered yet", dashed: true };
  if (s === "tentative") return { className: "", note: " · you said maybe", dashed: true };
  return { className: "", note: "", dashed: false };
}

// A length of time in words: "45 min", "2 h", "1 h 30 min".
export const length = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`);
export const formatTime = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

// True if the event covers any part of that local day (handles multi-day and past-midnight events).
export function overlapsDay(e: Timed, day: Date) {
  const dayStart = startOfDay(day);
  return parseWhen(e.start, e.allDay) < addDays(dayStart, 1) && parseWhen(e.end, e.allDay) > dayStart;
}

// Already over today (ended since midnight). The Agenda lists what's still ahead, so it leaves these out; earlier
// days keep theirs, as a record.
export function endedToday(e: Timed, now: Date) {
  const end = parseWhen(e.end, e.allDay);
  return end <= now && end > startOfDay(now);
}

// Busy time within [from, to), with overlapping events merged. Events marked "free" in Google don't count.
export function busyIntervals(events: Busy[], from: Date, to: Date): Interval[] {
  const spans = events
    .filter((e) => e.busy)
    .map((e) => {
      const s = parseWhen(e.start, e.allDay);
      const en = parseWhen(e.end, e.allDay);
      return { start: s > from ? s : from, end: en < to ? en : to };
    })
    .filter((s) => s.start < s.end)
    .sort((a, b) => +a.start - +b.start);

  const merged: Interval[] = [];
  for (const s of spans) {
    const last = merged.at(-1);
    if (last && s.start <= last.end) {
      if (s.end > last.end) last.end = s.end;
    } else merged.push({ ...s });
  }
  return merged;
}

// Gaps of at least minMinutes between busy blocks within [from, to).
export function freeSlots(events: Busy[], from: Date, to: Date, minMinutes = 15): Interval[] {
  const min = minMinutes * 60_000;
  const slots: Interval[] = [];
  let cursor = from;
  for (const b of busyIntervals(events, from, to)) {
    if (+b.start - +cursor >= min) slots.push({ start: cursor, end: b.start });
    if (b.end > cursor) cursor = b.end;
  }
  if (+to - +cursor >= min) slots.push({ start: cursor, end: to });
  return slots;
}

// The part of a day that can still be booked: any hour, starting no earlier than now (rounded up to 15 min).
export function bookableWindow(day: Date, now: Date): Interval | null {
  const from = startOfDay(day);
  const to = addDays(from, 1);
  const q = 15 * 60_000;
  const nowUp = new Date(Math.ceil(+now / q) * q);
  const start = nowUp > from ? nowUp : from;
  return start < to ? { start, end: to } : null;
}

// Side-by-side placement for overlapping timed events: a column index and how many columns its overlap group needs.
export function layoutColumns<T extends Timed>(events: T[]): { event: T; col: number; cols: number }[] {
  const ms = (e: T) => [+parseWhen(e.start, e.allDay), +parseWhen(e.end, e.allDay)];
  const sorted = [...events].sort((a, b) => ms(a)[0] - ms(b)[0] || ms(b)[1] - ms(a)[1]);
  const out: { event: T; col: number; cols: number }[] = [];
  let group: { event: T; col: number; cols: number }[] = [];
  let colEnds: number[] = [];
  let groupEnd = -Infinity;

  const flush = () => {
    for (const g of group) g.cols = colEnds.length;
    out.push(...group);
    group = [];
    colEnds = [];
  };

  for (const e of sorted) {
    const [s, en] = ms(e);
    if (group.length && s >= groupEnd) flush();
    let col = colEnds.findIndex((end) => end <= s);
    if (col === -1) col = colEnds.push(en) - 1;
    else colEnds[col] = en;
    group.push({ event: e, col, cols: 0 });
    groupEnd = group.length === 1 ? en : Math.max(groupEnd, en);
  }
  flush();
  return out;
}

// The greeting on wide screens, by the hour on the browser's clock.
export function greeting(hour: number, first: string) {
  if (hour < 5) return `Up late, ${first}?`;
  if (hour < 8) return `Early start, ${first}`;
  if (hour < 12) return `Good morning, ${first}`;
  if (hour < 17) return `Good afternoon, ${first}`;
  if (hour < 21) return `Good evening, ${first}`;
  return `Winding down, ${first}?`;
}

// Splits text so the dates and times in it can be shown bold: odd items are the times ("in 2 days", "due tomorrow
// night", "5:00 pm", "Sun, 15 Nov"), even items the words around them.
const WHEN =
  /(\bin \d+ (?:min|h|days?|weeks?)\b|\b(?:due |by |starts )?(?:today|tomorrow|tonight|overdue)(?: (?:morning|afternoon|evening|night))?\b|\b\d{1,2}(?::\d{2})? ?[ap]m\b|\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,? \d{1,2} [a-z]{3}\b)/gi;
export const whenParts = (text: string) => text.split(WHEN);
