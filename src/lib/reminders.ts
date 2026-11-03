// Which reminders are due, worked out on the server for any user time zone.

export type Reminder = { method: string; minutes: number }; // method "popup" = notification, "email" = Google emails it
export type Due = { minutes: number; fireAt: Date };

// A minute job that runs late (or skips a beat) still sends reminders due in this window.
export const CATCH_UP_MS = 10 * 60_000;
// shortcut: the minute job only looks 2 days ahead, so reminders set further ahead than that never push; widen with care (more Google calls every minute).
export const LOOKAHEAD_MS = 2 * 24 * 60 * 60_000 + 60 * 60_000;

// The instant a calendar day starts in a time zone ("2026-11-04" in Asia/Kolkata → 2026-11-03T18:30Z).
export function midnightIn(date: string, timeZone: string) {
  const guess = new Date(`${date}T00:00:00Z`);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(guess)
      .map((x) => [x.type, x.value]),
  );
  const offset = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - +guess;
  return new Date(+guess - offset);
}

// When a timed event and its calendar have no notification reminders at all, Almanac still reminds this long before,
// so nothing (e.g. classes on a shared timetable calendar) slips by. Reminders turned off on the event are respected.
export const FALLBACK_MINUTES = 10;

// Notification reminders of one event that are due now. `reminders` missing = the calendar's defaults (as in Google).
// All-day reminders count back from midnight at the start of that day, in the user's time zone (Google does the same).
export function dueReminders(
  e: { start: string; allDay: boolean; reminders?: Reminder[] },
  defaults: Reminder[],
  now: Date,
  timeZone: string,
): Due[] {
  const start = e.allDay ? midnightIn(e.start, timeZone) : new Date(e.start);
  const popups = (e.reminders ?? defaults).filter((r) => r.method === "popup").map((r) => r.minutes);
  if (!popups.length && !e.reminders && !e.allDay) popups.push(FALLBACK_MINUTES);
  const minutes = new Set(popups);
  return [...minutes]
    .map((m) => ({ minutes: m, fireAt: new Date(+start - m * 60_000) }))
    .filter((d) => d.fireAt <= now && +d.fireAt > +now - CATCH_UP_MS);
}

// "10 min before", "1 day before at 9:00 am" — the same words in the panel and the notification.
export function describeReminder(minutes: number, allDay: boolean) {
  if (allDay) {
    if (minutes === 0) return "At midnight on the day";
    const days = Math.ceil(minutes / 1440);
    const at = days * 1440 - minutes;
    const time = new Date(2000, 0, 1, Math.floor(at / 60), at % 60).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
    return `${days === 1 ? "The day" : `${days} days`} before at ${time}`;
  }
  if (minutes === 0) return "At the start";
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"} before`;
  if (minutes % 1440 === 0) return unit(minutes / 1440, "day");
  if (minutes % 60 === 0) return unit(minutes / 60, "hour");
  return `${minutes} min before`;
}
