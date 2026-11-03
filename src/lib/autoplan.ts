// The auto-planner's decisions: where to-dos and habits go in your free time, and which of Almanac's own blocks
// have to move because something else now sits there. Pure (no Google, no database), so it's tested; planner.ts
// feeds it and carries out the result. Only blocks Almanac booked ever move; your other events are fixed.

import { ymdIn } from "./plan";
import { shiftDate } from "./recurrence";
import { midnightIn } from "./reminders";
import { freeSlots, type Interval } from "./time";

const MIN = 60_000;
const HOUR = 60 * MIN;

export type TimeOfDay = "morning" | "afternoon" | "evening" | "any";
export const TIMES_OF_DAY: Record<TimeOfDay, [number, number]> = { morning: [8, 12], afternoon: [12, 17], evening: [17, 22], any: [8, 22] };

// block: where it's booked now (null = not booked). move: book it again even if nothing clashes (unfinished, rolled over).
export type PlanTodo = { id: string; minutes: number; due: Date | null; group: string | null; block: Interval | null; move?: boolean; notBefore?: Date };
export type PlanRoutine = { id: string; minutes: number; perWeek: number; timeOfDay: TimeOfDay; blocks: Interval[] };
// from null = a new booking; otherwise an existing block moves.
export type Placement = { kind: "todo" | "routine"; id: string; from: Interval | null; to: Interval };
export type Plan = { placements: Placement[]; unplaced: { kind: "todo" | "routine"; id: string; from: Interval | null }[] };

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;
const asEvents = (spans: Interval[]) => spans.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString(), allDay: false, busy: true }));
const weekOf = (day: string) => shiftDate(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7)); // its Monday

// busy: your own events (timed, not Almanac's blocks). Plans the next `days` days, from today in your time zone.
export function autoPlan(busy: Interval[], todos: PlanTodo[], routines: PlanRoutine[], now: Date, timeZone: string, days = 7): Plan {
  const q = 15 * MIN;
  const earliest = new Date(Math.ceil((+now + 15 * MIN) / q) * q); // never book something to start this very minute
  const today = ymdIn(now, timeZone);
  const horizon = Array.from({ length: days }, (_, i) => shiftDate(today, i));
  const lastDayEnd = midnightIn(shiftDate(today, days), timeZone);
  const taken = [...busy];
  const plan: Plan = { placements: [], unplaced: [] };
  // A future block clashes with your events, or with one of Almanac's blocks already kept (e.g. after a to-do was made longer).
  const clashes = (b: Interval) => b.start >= now && taken.some((x) => overlaps(b, x));

  // The first free stretch of `minutes` on one of `dayList`, inside the hours of `hours`, from `from` and ending by `by`.
  function find(minutes: number, dayList: string[], hours: [number, number], from: Date, by: Date) {
    for (const day of dayList) {
      const midnight = +midnightIn(day, timeZone);
      const s = new Date(Math.max(midnight + hours[0] * HOUR, +from));
      const e = new Date(Math.min(midnight + hours[1] * HOUR, +by));
      if (s >= e) continue;
      const slot = freeSlots(asEvents(taken), s, e, minutes)[0];
      if (slot) return { start: slot.start, end: new Date(+slot.start + minutes * MIN) };
    }
    return null;
  }

  // To-dos: blocks that still fit stay put. The rest are placed most urgent first.
  const groupDays = new Map<string, Set<string>>();
  const markGroup = (t: PlanTodo, at: Interval) => {
    if (!t.group) return;
    const set = groupDays.get(t.group) ?? new Set<string>();
    set.add(ymdIn(at.start, timeZone));
    groupDays.set(t.group, set);
  };
  const toPlace: PlanTodo[] = [];
  for (const t of todos) {
    const late = t.block && t.due && t.due > now && t.block.end > t.due && t.block.start >= now;
    if (t.block && !t.move && !clashes(t.block) && !late) {
      taken.push(t.block);
      markGroup(t, t.block);
    } else toPlace.push(t);
  }
  toPlace.sort((a, b) => (a.due ? +a.due : Infinity) - (b.due ? +b.due : Infinity));
  for (const t of toPlace) {
    // A deadline already passed doesn't limit anything any more; the work still needs a time.
    const by = t.due && t.due > earliest ? t.due : lastDayEnd;
    const from = t.notBefore && t.notBefore > earliest ? t.notBefore : earliest;
    // Parts of a split task go on different days.
    const used = t.group ? groupDays.get(t.group) : undefined;
    const to = find(t.minutes, used ? horizon.filter((d) => !used.has(d)) : horizon, TIMES_OF_DAY.any, from, by);
    if (to) {
      taken.push(to);
      markGroup(t, to);
      plan.placements.push({ kind: "todo", id: t.id, from: t.block, to });
    } else plan.unplaced.push({ kind: "todo", id: t.id, from: t.block });
  }

  // Habits and focus time: as many sessions per week as asked for, one a day, spread out across the week.
  for (const r of routines) {
    const kept: Interval[] = [];
    const moving: Interval[] = [];
    for (const b of r.blocks) {
      if (clashes(b)) moving.push(b);
      else {
        kept.push(b);
        taken.push(b);
      }
    }
    const keptDays = new Set(kept.map((b) => ymdIn(b.start, timeZone)));
    for (const week of new Set(horizon.map(weekOf))) {
      const inView = horizon.filter((d) => weekOf(d) === week);
      // A later week only partly in view gets its fair share for now, so sessions don't bunch up at its start.
      const target = week === weekOf(today) ? r.perWeek : Math.min(r.perWeek, Math.ceil((r.perWeek * inView.length) / 7));
      let need = target - kept.filter((b) => weekOf(ymdIn(b.start, timeZone)) === week).length;
      const candidates = inView.filter((d) => !keptDays.has(d));
      const fromQueue = moving.filter((b) => weekOf(ymdIn(b.start, timeZone)) === week);
      // Evenly spaced days first (3 a week → e.g. Mon, Wed, Fri), then the rest as fallbacks.
      const spread = need > 0 && need < candidates.length ? Array.from({ length: need }, (_, i) => candidates[Math.floor((i * candidates.length) / need)]) : candidates;
      const order = [...spread, ...candidates.filter((d) => !spread.includes(d))];
      for (const day of order) {
        if (need <= 0) break;
        const to = find(r.minutes, [day], TIMES_OF_DAY[r.timeOfDay], earliest, lastDayEnd);
        if (!to) continue;
        taken.push(to);
        need--;
        plan.placements.push({ kind: "routine", id: r.id, from: fromQueue.shift() ?? null, to });
      }
      for (const b of fromQueue) plan.unplaced.push({ kind: "routine", id: r.id, from: b });
    }
  }
  return plan;
}
