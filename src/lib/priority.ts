// Task triage: what kind of task each event is, how severe it is now, and when "Later" is still safe.
// Pure rules (no AI): the kind of task (from its words, guests and calendar) plus time left.
// Runs on the server and in the browser.

export type Severity = "low" | "medium" | "high" | "critical";
export const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];
export type Status = "open" | "doing" | "later" | "stuck" | "done";
export type Category = "deadline" | "work" | "personal" | "leisure" | "other";

export const WINDOW_DAYS = 5;
// "Later" must leave at least this long before the deadline.
export const SAFETY_MS = 2 * 60 * 60_000;

const HOUR = 60 * 60_000;
const SOON_HOURS = 3;

// "under an hour", "5 h", "2 days".
export function timeLeft(due: Date, now: Date) {
  const hours = (+due - +now) / HOUR;
  const days = Math.round(hours / 24);
  return hours < 1 ? "under an hour" : hours < 23.5 ? `${Math.round(hours)} h` : `${days} day${days === 1 ? "" : "s"}`;
}
export const CATEGORY_LABEL: Record<Category, string> = {
  deadline: "Deadline",
  work: "Work",
  personal: "Personal",
  leisure: "Leisure",
  other: "Event",
};

// Checked in this order, first match wins: "lunch meeting" is work, "gym with friends" is leisure.
// The number is how important that kind of task is: 3 deadline … 0 leisure.
const KINDS: [Category, RegExp, number][] = [
  ["deadline", /\b(exam|exams|final|finals|submission|submit|viva|interview|deadline|due)\b/i, 3],
  [
    "work",
    /\b(meeting|meetings|prep|prepare|preparation|office|work|client|clients|team|project|report|presentation|assignment|class|lecture|review|call|standup|sync|deck|proposal|test|quiz|study|revision|doctor|hospital|appointment|bank|bill|payment|visa|flight|train)\b/i,
    2,
  ],
  ["leisure", /\b(gym|workout|yoga|run|running|walk|movie|movies|game|games|netflix|nap|swim|swimming|cricket|football|badminton)\b/i, 0],
  ["personal", /\b(lunch|dinner|breakfast|coffee|party|birthday|family|friend|friends|date|hangout|shopping)\b/i, 1],
];
const SMALL_WORDS = /\b(practice|optional|reading|draft|mock)\b/i;

export type Item = { calendarId: string; calendarName?: string; title: string; description?: string; busy?: boolean; guests?: number };

export function classify(e: Item): { category: Category; word?: string; importance: number } {
  // The title decides; the notes only count when the title has no telling words.
  for (const text of [e.title, e.description ?? ""]) {
    for (const [category, words, importance] of KINDS) {
      const m = text.match(words);
      if (m) return { category, word: m[0].toLowerCase(), importance };
    }
  }
  // No telling words: a personal calendar means personal; other people invited means a work-style meeting.
  if (/family|personal|birthday/i.test(e.calendarName ?? "")) return { category: "personal", importance: 1 };
  if (e.guests) return { category: "work", word: "meeting", importance: 2 };
  return { category: "other", importance: 1 };
}

// Which events belong in Priorities: your choice wins; otherwise anything that blocks your time, plus
// deadline/work items even when marked "free" (all-day "Assignment due" events usually are). Never holidays.
export function isTracked(e: Item, manual: boolean | null) {
  if (manual !== null) return manual;
  if (e.calendarId.includes("#holiday@")) return false;
  return !!e.busy || ["deadline", "work"].includes(classify(e).category);
}

const up = (s: Severity, steps: number) => SEVERITIES[Math.min(SEVERITIES.length - 1, Math.max(0, SEVERITIES.indexOf(s) + steps))];

// Suggested severity: how important the kind of task is, lowered the further away it is
// (full within 24 h, one level less within 3 days, two less beyond), and one level higher when it's within
// SOON_HOURS: a presentation in an hour outranks an exam tomorrow. Reason e.g. "Work (prep) · in 5 h".
export function suggest(e: Item, due: Date, now: Date): { severity: Severity; reason: string; category: Category } {
  const { category, word, importance } = classify(e);
  const hours = (+due - +now) / HOUR;
  const distance = hours <= 24 ? 0 : hours <= 72 ? 1 : 2;
  const small = SMALL_WORDS.test(`${e.title} ${e.description ?? ""}`) ? 1 : 0;
  const soon = hours <= SOON_HOURS ? 1 : 0;
  const severity = SEVERITIES[Math.min(3, Math.max(0, importance - distance - small + soon))];

  const reason = `${CATEGORY_LABEL[category]}${word ? ` (${word})` : ""} · in ${timeLeft(due, now)}`;
  return { severity, reason, category };
}

// Your choice wins. Otherwise the suggestion, one level higher for every two "Later"s.
export function effective(suggested: Severity, chosen: Severity | null, laterCount: number) {
  return chosen ?? up(suggested, Math.floor(laterCount / 2));
}

// Choices are remembered per event name, so "Gym" set to Low once stays Low for every session.
export const titleKey = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

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
