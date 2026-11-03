// Deadline triage: which events are deadlines, how severe they are, and when "Later" is still safe.
// Pure rules (no AI): time left plus what the title says. Runs on the server and in the browser.

export type Severity = "low" | "medium" | "high" | "critical";
export const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];
export type Status = "open" | "doing" | "later" | "stuck" | "done";

export const WINDOW_DAYS = 5;
// "Later" must leave at least this long before the deadline.
export const SAFETY_MS = 2 * 60 * 60_000;

const HOUR = 60 * 60_000;
const DEADLINE_WORDS = /\b(due|deadline|submit|submission|exam|exams|test|quiz|assignment|project|presentation|viva|report|interview|final|finals)\b/i;
const BIG_WORDS = /\b(exam|exams|final|finals|submission|viva|interview|presentation)\b/i;
const SMALL_WORDS = /\b(practice|optional|reading|draft|mock)\b/i;

export type Item = { calendarId: string; title: string; description?: string; busy?: boolean };

// Manual choice wins; otherwise deadline words in the title or notes. Holiday calendars never count.
export function isDeadline(e: Item, manual: boolean | null) {
  if (manual !== null) return manual;
  if (e.calendarId.includes("#holiday@")) return false;
  return DEADLINE_WORDS.test(`${e.title} ${e.description ?? ""}`);
}

const up = (s: Severity, steps: number) => SEVERITIES[Math.min(SEVERITIES.length - 1, Math.max(0, SEVERITIES.indexOf(s) + steps))];

// Suggested severity and a one-line reason, e.g. "Due in 18 h · exam".
export function suggest(e: Item, due: Date, now: Date): { severity: Severity; reason: string } {
  const text = `${e.title} ${e.description ?? ""}`;
  const big = text.match(BIG_WORDS)?.[0].toLowerCase();
  const hours = (+due - +now) / HOUR;
  let severity: Severity = hours <= 24 ? "critical" : hours <= 48 ? "high" : hours <= 120 ? "medium" : "low";
  if (big && hours > 24) severity = up(severity, 1);
  if (SMALL_WORDS.test(text)) severity = up(severity, -1);
  const left = hours < 1 ? "under an hour" : hours < 48 ? `${Math.round(hours)} h` : `${Math.round(hours / 24)} days`;
  return { severity, reason: [`Due in ${left}`, big].filter(Boolean).join(" · ") };
}

// Your choice wins. Otherwise the suggestion, one level higher for every two "Later"s.
export function effective(suggested: Severity, override: Severity | null, laterCount: number) {
  return override ?? up(suggested, Math.floor(laterCount / 2));
}

// Most urgent first: open before done, then severity, then whichever is due sooner.
export function byPriority<T extends { severity: Severity; status: Status; due: string }>(a: T, b: T) {
  return (
    Number(a.status === "done") - Number(b.status === "done") ||
    SEVERITIES.indexOf(b.severity) - SEVERITIES.indexOf(a.severity) ||
    +new Date(a.due) - +new Date(b.due)
  );
}

export const latestSafe = (due: Date) => new Date(+due - SAFETY_MS);

// Times offered for "Later" (in the viewer's own clock), only those that still leave room before the deadline.
export function laterOptions(now: Date, due: Date): { label: string; at: Date }[] {
  const at = (h: number, daysAhead = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + daysAhead);
    d.setHours(h, 0, 0, 0);
    return d;
  };
  const options = [
    { label: "In 1 hour", at: new Date(+now + HOUR) },
    { label: "In 3 hours", at: new Date(+now + 3 * HOUR) },
    { label: "Tonight 8 pm", at: at(20) },
    { label: "Tomorrow 9 am", at: at(9, 1) },
  ];
  const limit = latestSafe(due);
  return options.filter((o, i) => +o.at > +now + 30 * 60_000 && o.at <= limit && !options.slice(0, i).some((p) => Math.abs(+p.at - +o.at) < HOUR));
}
