// Advice from your calendar and lists, by rules (no AI): what to do right now, today's plan, and the week in review.
// Pure, so it's tested; coach-data.ts reads Google and the database and feeds it. It only advises: anything that
// books time is a button the person presses.

import { freeByDay, ymdIn } from "./plan";
import { CATEGORY_LABEL, classify, SEVERITIES, suggest, type Category, type Severity, type Status } from "./priority";
import { midnightIn } from "./reminders";
import { length, type Interval } from "./time";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const LATE_HOUR = 22; // after this (and before EARLY_HOUR) the advice is to rest
const EARLY_HOUR = 7;

type Busy = { title: string; start: string; end: string; allDay: boolean; busy: boolean; calendarId?: string; description?: string };
type TodoIn = { id: string; title: string; minutes: number; due_at: Date | null; done: boolean; event_id: string | null };
type DeadlineIn = { key: string; title: string; due: string; severity: Severity; reason: string; category: Category; status: Status };

// Something that needs your time, ranked like Priorities: severity first, then whichever is due sooner.
export type Work = { key: string; title: string; minutes: number; due: Date | null; severity: Severity; why: string; todoId?: string };
// One piece of advice: do this, for this long (bookable with one button).
export type Pick = { title: string; why: string; minutes: number; todoId?: string };

const time = (d: Date, tz: string) => d.toLocaleTimeString("en-IN", { timeZone: tz, hour: "numeric", minute: "2-digit" });
const dayTime = (d: Date, tz: string) => d.toLocaleString("en-IN", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit" });
const hourIn = (d: Date, tz: string) => +new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(d);

// Open to-dos that aren't booked yet, and coming deadlines (exam, submission…) to prepare for.
export function workList(todos: TodoIn[], deadlines: DeadlineIn[], now: Date, tz: string): Work[] {
  const fromTodos = todos
    .filter((t) => !t.done && !t.event_id)
    .map((t): Work => {
      const { severity } = suggest({ calendarId: "", title: t.title }, t.due_at ?? new Date(+now + 7 * DAY), now);
      const why = !t.due_at ? "On your to-do list" : t.due_at < now ? `Overdue since ${dayTime(t.due_at, tz)}` : `Due ${dayTime(t.due_at, tz)}`;
      return { key: `todo:${t.id}`, title: t.title, minutes: t.minutes, due: t.due_at, severity: t.due_at && t.due_at < now ? "high" : severity, why, todoId: t.id };
    });
  const fromDeadlines = deadlines
    .filter((p) => p.category === "deadline" && p.status !== "done")
    .map((p): Work => ({ key: `deadline:${p.key}`, title: `Prepare for ${p.title}`, minutes: 60, due: new Date(p.due), severity: p.severity, why: p.reason }));
  const rank = (w: Work) => SEVERITIES.indexOf(w.severity);
  return [...fromTodos, ...fromDeadlines].sort((a, b) => rank(b) - rank(a) || (a.due ? +a.due : Infinity) - (b.due ? +b.due : Infinity));
}

const timedSpans = (events: Busy[]) =>
  events
    .filter((e) => e.busy && !e.allDay)
    .map((e) => ({ title: e.title, start: new Date(e.start), end: new Date(e.end) }))
    .sort((a, b) => +a.start - +b.start);

export type NowAnswer = {
  state: "busy" | "soon" | "late" | "free";
  headline: string;
  detail: string;
  picks: Pick[]; // most important first; "Something else" shows the next
};

// "What should I do now?": one answer, from whether you're in something, how long you're free, and what matters most.
export function whatNow(events: Busy[], work: Work[], now: Date, tz: string): NowAnswer {
  const spans = timedSpans(events);
  const current = spans.find((s) => s.start <= now && s.end > now);
  const next = spans.find((s) => s.start > now);
  if (current) {
    return { state: "busy", headline: `You're in “${current.title}” until ${time(current.end, tz)}.`, detail: "Give it your attention; ask again when it's over.", picks: [] };
  }
  const hour = hourIn(now, tz);
  if (hour >= LATE_HOUR || hour < EARLY_HOUR) {
    return { state: "late", headline: "It's late. Rest now.", detail: next ? `Next up: “${next.title}”, ${dayTime(next.start, tz)}.` : "Nothing is booked next.", picks: [] };
  }
  const endOfDay = new Date(+midnightIn(ymdIn(now, tz), tz) + LATE_HOUR * 60 * MIN);
  const freeUntil = next && next.start < endOfDay ? next.start : endOfDay;
  const gap = Math.floor((+freeUntil - +now) / MIN);
  if (next && next.start <= freeUntil && gap <= 20) {
    return { state: "soon", headline: `Get ready: “${next.title}” starts at ${time(next.start, tz)}.`, detail: `That's in ${gap} min.`, picks: [] };
  }
  // Most important first, even if it won't fit: starting the urgent thing beats finishing a small one.
  const usable = Math.floor(gap / 5) * 5;
  const picks = work.slice(0, 5).map((w) => ({
    title: w.title,
    why: w.minutes <= gap ? `${w.why}. Takes ${length(w.minutes)}.` : `${w.why}. It takes ${length(w.minutes)}; make a start now.`,
    minutes: Math.min(w.minutes, usable),
    todoId: w.todoId,
  }));
  const until = `You have ${length(gap)} free, until ${time(freeUntil, tz)}${next && next.start <= freeUntil ? `, then “${next.title}”` : ""}.`;
  return picks.length
    ? { state: "free", headline: `Do “${picks[0].title}” now.`, detail: until, picks }
    : { state: "free", headline: "Nothing is waiting on you. Enjoy the break, or add a to-do.", detail: until, picks: [] };
}

export type DayPlan = {
  count: number; // events today
  first: { title: string; start: string } | null;
  last: { title: string; end: string } | null;
  freeMinutes: number; // waking free time left today
  blocks: (Pick & { start: string; end: string })[]; // the most important work that fits each free stretch
};

// Today at a glance: your events, your free stretches, and what to put in them (up to 4 suggestions).
export function dayPlan(events: Busy[], work: Work[], now: Date, tz: string): DayPlan {
  const today = ymdIn(now, tz);
  const spans = timedSpans(events).filter((s) => ymdIn(s.start, tz) === today);
  const slots = freeByDay(events, now, tz, 1, 30)[0].slots;
  const left = [...work];
  const blocks: DayPlan["blocks"] = [];
  for (const slot of slots) {
    if (blocks.length >= 4) break;
    const room = (+slot.end - +slot.start) / MIN;
    const i = left.findIndex((w) => w.minutes <= room);
    if (i < 0) continue;
    const [w] = left.splice(i, 1);
    blocks.push({ title: w.title, why: w.why, minutes: w.minutes, todoId: w.todoId, start: slot.start.toISOString(), end: new Date(+slot.start + w.minutes * MIN).toISOString() });
  }
  return {
    count: spans.length,
    first: spans[0] ? { title: spans[0].title, start: spans[0].start.toISOString() } : null,
    last: spans.at(-1) ? { title: spans.at(-1)!.title, end: spans.at(-1)!.end.toISOString() } : null,
    freeMinutes: Math.round(slots.reduce((m, s) => m + (+s.end - +s.start) / MIN, 0)),
    blocks,
  };
}

// The 8 am notification: "Today: 4 events, 3 h free" · "2:40 pm → Finance assignment".
export function dayPlanText(p: DayPlan, tz: string) {
  const title = `Today: ${p.count} event${p.count === 1 ? "" : "s"}${p.first ? `, first ${time(new Date(p.first.start), tz)}` : ""} · ${length(p.freeMinutes)} free`;
  const body = p.blocks.length ? p.blocks.map((b) => `${time(new Date(b.start), tz)} → ${b.title}`).join(" · ") : "Nothing waiting on you. Open Almanac to plan ahead.";
  return { title, body };
}

export type WeekReview = {
  from: string;
  to: string;
  totalMinutes: number;
  byCategory: { category: Category; label: string; minutes: number }[];
  busiestDay: { day: string; minutes: number } | null;
  done: string[]; // to-dos ticked off and deadlines marked done
  deadlines: { met: number; total: number };
  unmarked: string[]; // deadlines that passed without being marked done in Priorities
  overdue: string[]; // open to-dos past their due time
};

// The last 7 days: where your time went (by kind of task), what got done, and what slipped.
export function weekReview(
  events: Busy[],
  todosDone: string[],
  deadlines: { title: string; due_at: Date; status: Status }[],
  overdue: string[],
  now: Date,
  tz: string,
): WeekReview {
  const from = new Date(+now - 7 * DAY);
  const byCategory = new Map<Category, number>();
  const byDay = new Map<string, number>();
  let total = 0;
  for (const e of events) {
    if (!e.busy || e.allDay) continue;
    const s = Math.max(+new Date(e.start), +from);
    const en = Math.min(+new Date(e.end), +now);
    if (en <= s) continue;
    const minutes = (en - s) / MIN;
    const { category } = classify({ calendarId: e.calendarId ?? "", title: e.title, description: e.description });
    byCategory.set(category, (byCategory.get(category) ?? 0) + minutes);
    const day = ymdIn(new Date(s), tz);
    byDay.set(day, (byDay.get(day) ?? 0) + minutes);
    total += minutes;
  }
  const busiest = [...byDay].sort((a, b) => b[1] - a[1])[0];
  const passed = deadlines.filter((d) => d.due_at >= from && d.due_at <= now);
  return {
    from: from.toISOString(),
    to: now.toISOString(),
    totalMinutes: Math.round(total),
    byCategory: [...byCategory]
      .map(([category, minutes]) => ({ category, label: CATEGORY_LABEL[category], minutes: Math.round(minutes) }))
      .sort((a, b) => b.minutes - a.minutes),
    busiestDay: busiest ? { day: busiest[0], minutes: Math.round(busiest[1]) } : null,
    done: [...todosDone, ...passed.filter((d) => d.status === "done").map((d) => d.title)],
    deadlines: { met: passed.filter((d) => d.status === "done").length, total: passed.length },
    unmarked: passed.filter((d) => d.status !== "done").map((d) => d.title),
    overdue,
  };
}

type ClashEv = Busy & { id: string; calendarId: string; plan?: string; away?: string; attendees?: { self?: boolean }[] };

// The morning check: today's clashes between your own events, each with a fix for you to approve — move one of the
// pair to the nearest free time today. Only events that can move without telling anyone: on a calendar you can
// edit (`editable`), no guests, not started yet. The less important one moves (gym before a meeting); if equal, the
// later one. Almanac's own blocks are left to the auto-planner.
// shortcut: no free time later today → no fix; offer tomorrow if people ask for it.
export function clashFixes<E extends ClashEv>(events: E[], editable: Set<string>, now: Date, tz: string) {
  const today = ymdIn(now, tz);
  const startOf = (e: E) => +new Date(e.start);
  let busy = events.filter((e) => e.busy && !e.allDay);
  const own = busy.filter((e) => !e.plan && ymdIn(new Date(e.start), tz) === today && new Date(e.end) > now).sort((a, b) => startOf(a) - startOf(b));
  // Out of office / focus time is never the one moved: the meeting clashing with it is.
  const movable = (e: E) => editable.has(e.calendarId) && !e.away && !e.attendees?.some((a) => !a.self) && startOf(e) > +now;
  const done = new Set<E>();
  const fixes: { event: E; other: E; to: Interval }[] = [];
  for (const [i, a] of own.entries()) {
    for (const b of own.slice(i + 1)) {
      if (startOf(b) >= +new Date(a.end)) break; // sorted by start, so the rest start later still
      if (done.has(a) || done.has(b)) continue;
      const pick = [b, a].filter(movable).sort((x, y) => classify(x).importance - classify(y).importance)[0];
      if (!pick) continue;
      const len = +new Date(pick.end) - startOf(pick);
      const rest = busy.filter((e) => e !== pick);
      let to: Interval | null = null;
      for (const s of freeByDay(rest, now, tz, 1, len / MIN)[0].slots) {
        const start = Math.max(+s.start, Math.min(startOf(pick), +s.end - len));
        if (!to || Math.abs(start - startOf(pick)) < Math.abs(+to.start - startOf(pick))) to = { start: new Date(start), end: new Date(start + len) };
      }
      if (!to) continue;
      done.add(pick);
      fixes.push({ event: pick, other: pick === a ? b : a, to });
      busy = [...rest, { ...pick, start: to.start.toISOString(), end: to.end.toISOString() }]; // later fixes avoid this time
    }
  }
  return fixes;
}
