// Date helpers that run in the browser, so "local" means the viewer's own time zone.

type Timed = { start: string; end: string; allDay: boolean };

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

// True if the event covers any part of that local day (handles multi-day and past-midnight events).
export function overlapsDay(e: Timed, day: Date) {
  const dayStart = startOfDay(day);
  return parseWhen(e.start, e.allDay) < addDays(dayStart, 1) && parseWhen(e.end, e.allDay) > dayStart;
}
