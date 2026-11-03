// Planning in the user's own time zone (not the server's): free time per day and the first slot that fits a task.
// Pure, so it runs anywhere and is tested.

import type { Ev } from "./calendar";
import { midnightIn } from "./reminders";
import { freeSlots, FREE_FROM_HOUR, FREE_TO_HOUR, type Interval } from "./time";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
type Busy = Pick<Ev, "start" | "end" | "allDay" | "busy">;

// The calendar date of an instant in a time zone: "2026-11-04".
export const ymdIn = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

// An instant as wall-clock time in a time zone: "2026-11-04T15:30".
export const toLocal = (d: Date, timeZone: string) =>
  `${ymdIn(d, timeZone)}T${new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d)}`;

// "2026-11-04T15:30" in a time zone → the instant, or null if it isn't a valid time.
// shortcut: counts hours from local midnight, so times on a daylight-saving changeover day are an hour off; fine for India (no DST).
export function fromLocal(s: string, timeZone: string) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(s);
  if (!m || +m[2] > 23 || +m[3] > 59) return null;
  const d = new Date(+midnightIn(m[1], timeZone) + +m[2] * HOUR + +m[3] * 60_000);
  return isNaN(+d) ? null : d;
}

// All-day events become real instants in the user's zone, so the free-time maths doesn't depend on the server's clock.
const instants = (events: Busy[], timeZone: string) =>
  events.map((e) =>
    e.allDay ? { ...e, allDay: false, start: midnightIn(e.start, timeZone).toISOString(), end: midnightIn(e.end, timeZone).toISOString() } : e,
  );

// Free waking-hour slots (8 am–10 pm) of at least minMinutes, for today and the following days, never before now.
export function freeByDay(events: Busy[], now: Date, timeZone: string, days: number, minMinutes = 30): { day: string; slots: Interval[] }[] {
  const evs = instants(events, timeZone);
  const q = 15 * 60_000;
  const nowUp = Math.ceil(+now / q) * q;
  return Array.from({ length: days }, (_, i) => {
    const day = ymdIn(new Date(+now + i * DAY), timeZone);
    const midnight = +midnightIn(day, timeZone);
    const from = new Date(Math.max(midnight + FREE_FROM_HOUR * HOUR, nowUp));
    const to = new Date(midnight + FREE_TO_HOUR * HOUR);
    return { day, slots: from < to ? freeSlots(evs, from, to, minMinutes) : [] };
  });
}

// The earliest free stretch that fits a task of `minutes`, ending by `before` when given; null if there's none.
export function pickSlot(events: Busy[], now: Date, timeZone: string, minutes: number, before?: Date | null, days = 7): Interval | null {
  for (const { slots } of freeByDay(events, now, timeZone, days, minutes)) {
    if (!slots.length) continue;
    const start = slots[0].start;
    const end = new Date(+start + minutes * 60_000);
    return before && end > before ? null : { start, end };
  }
  return null;
}
