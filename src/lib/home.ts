// Home's action list: everything you have to do, from everywhere, in one list: to-dos, deadlines and important
// events (Priorities), what was found in your email, and the planner's suggestions. Grouped Today, Overdue, This
// week, This month; most urgent first in each. Every item says whether it can be booked into free time now (fit)
// or needs you to decide. The buttons use the actions each source already has (to-dos, priorities, mail, coach).

import { gather } from "./coach-data";
import { prepStates, type PrepState } from "./coach";
import type { Ev } from "./calendar";
import { waitingFinds, type MailFind } from "./mail";
import { pickSlot, ymdIn } from "./plan";
import { listSuggestions, type Suggestion, type User } from "./planner";
import type { Priority } from "./priorities";
import { SEVERITIES, type Severity } from "./priority";
import { midnightIn } from "./reminders";

const DAY = 86_400_000;

export type Group = "today" | "overdue" | "week" | "month";
export const GROUPS: Group[] = ["overdue", "today", "week", "month"]; // the order Home shows them in

// source: where it comes from. when: what it's grouped by (due, or start). fit: free time it can be booked into
// now. booked: already on the calendar then. act: what its buttons do, with the id each source's own API needs.
export type ActionItem = {
  key: string;
  source: "todo" | "calendar" | "email" | "plan";
  title: string;
  when: string;
  allDay: boolean;
  severity: Severity | null;
  note: string;
  fit: { start: string; end: string } | null;
  booked: string | null;
  act:
    | { kind: "todo"; id: string; suggestion?: string }
    | { kind: "priority"; calendarId: string; eventId: string; prep?: string }
    | { kind: "find"; id: string; pickTime: boolean; quote: string }
    | { kind: "suggestion"; id: string; move: boolean };
};

type TodoIn = { id: string; title: string; minutes: number; due_at: Date | null; done: boolean; event_id: string | null; scheduled_at: Date | null; ai?: { severity: Severity; reason: string } };
type Input = { todos: TodoIn[]; priorities: Priority[]; risks: PrepState[]; finds: MailFind[]; suggestions: Suggestion[]; events: Pick<Ev, "start" | "end" | "allDay" | "busy">[] };

const iso = (d: Date) => d.toISOString();
const span = (s: Date, e: Date) => ({ start: iso(s), end: iso(e) });

// Pure: the list, grouped. Undated to-dos aren't on Home (they're in To-do); nothing past this month is either.
export function buildActions(i: Input, now: Date, tz: string): Record<Group, ActionItem[]> {
  const tonight = midnightIn(ymdIn(new Date(+midnightIn(ymdIn(now, tz), tz) + 36 * 3_600_000), tz), tz);
  const groupOf = (when: Date): Group | null =>
    +when < +now ? "overdue" : +when < +tonight ? "today" : +when < +tonight + 7 * DAY ? "week" : +when < +tonight + 31 * DAY ? "month" : null;
  const forTodo = new Map(i.suggestions.filter((s) => s.kind === "todo" && s.item_id).map((s) => [s.item_id!, s]));
  const todoEvents = new Set(i.todos.map((t) => t.event_id).filter(Boolean));
  const riskOf = new Map(i.risks.map((r) => [r.key, r]));
  const items: ActionItem[] = [];

  for (const t of i.todos) {
    if (t.done || !t.due_at) continue;
    const due = new Date(t.due_at);
    const s = forTodo.get(t.id);
    // Unbooked: the planner's suggested time, else the first free time that finishes before it's due (this week).
    const slot = t.event_id ? null : s ? { start: s.to_start, end: s.to_end } : +due > +now ? pickSlot(i.events, now, tz, t.minutes, due) : null;
    items.push({
      key: `todo:${t.id}`,
      source: "todo",
      title: t.title,
      when: iso(due),
      allDay: false,
      severity: t.ai?.severity ?? null,
      note: t.event_id ? "On your calendar" : slot ? `${t.minutes} min · free time before it's due` : +due < +now ? `${t.minutes} min · past its due time` : `${t.minutes} min · no free time before it's due`,
      fit: slot ? span(slot.start, slot.end) : null,
      booked: t.scheduled_at && t.event_id ? iso(new Date(t.scheduled_at)) : null,
      act: { kind: "todo", id: t.id, suggestion: s?.id },
    });
  }

  for (const p of i.priorities) {
    if (p.status === "done" || todoEvents.has(p.eventId)) continue; // a booked to-do is already listed as itself
    const r = riskOf.get(p.key);
    items.push({
      key: `priority:${p.key}`,
      source: "calendar",
      title: p.title,
      when: p.due,
      allDay: p.allDay,
      severity: p.severity,
      note: r ? `${Math.round(r.left / 60)}h of prep left, ${Math.round(r.free / 60)}h free before it` : p.reason,
      fit: null,
      booked: null,
      act: { kind: "priority", calendarId: p.calendarId, eventId: p.eventId, prep: r && r.free > 0 ? p.key : undefined },
    });
  }

  for (const f of i.finds) {
    items.push({
      key: `find:${f.id}`,
      source: "email",
      title: f.title,
      when: iso(new Date(f.start_at)),
      allDay: false,
      severity: null,
      note: `${f.summary || `“${f.quote}”`} · from ${f.sender}${f.pick_time ? " · the email gives no time, so this is a free one Almanac picked" : ""}`,
      // Meetings and calls: its time, or (none in the email) the free one Almanac suggested; Add books it, or the
      // time picked on the card instead. Deadlines have no length: Add makes them a to-do.
      fit: f.end_at ? span(new Date(f.start_at), new Date(f.end_at)) : null,
      booked: null,
      act: { kind: "find", id: f.id, pickTime: f.pick_time, quote: f.quote },
    });
  }

  for (const s of i.suggestions) {
    if (s.kind === "todo" && s.item_id && i.todos.some((t) => t.id === s.item_id && t.due_at && !t.done)) continue; // on its to-do
    items.push({
      key: `plan:${s.id}`,
      source: "plan",
      title: s.title,
      when: iso(new Date(s.to_start)),
      allDay: false,
      severity: null,
      note: s.from_event_id ? "Move it here: it clashes where it is" : s.kind === "routine" ? "Habit or focus time" : "Suggested time",
      fit: span(new Date(s.to_start), new Date(s.to_end)),
      booked: null,
      act: { kind: "suggestion", id: s.id, move: !!s.from_event_id },
    });
  }

  const out: Record<Group, ActionItem[]> = { today: [], overdue: [], week: [], month: [] };
  for (const it of items) {
    const g = groupOf(new Date(it.when));
    if (g) out[g].push(it);
  }
  const rank = (s: Severity | null) => (s ? SEVERITIES.indexOf(s) : 1); // unrated counts as medium
  for (const g of GROUPS) out[g].sort((a, b) => rank(b.severity) - rank(a.severity) || +new Date(a.when) - +new Date(b.when));
  return out;
}

export async function homeActions(u: User, now = new Date()) {
  const [{ events, priorities, todos, prepped }, finds, suggestions] = await Promise.all([gather(u, now), waitingFinds(u.id), listSuggestions(u.id)]);
  const risks = prepStates(events, priorities, prepped, now, u.timezone).filter((s) => s.level !== "ok");
  return buildActions({ todos, priorities, risks, finds, suggestions, events }, now, u.timezone);
}
