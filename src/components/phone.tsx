"use client";
import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Ev } from "@/lib/calendar";
import { addDays, parseWhen, startOfDay, startOfMonth, startOfWeek } from "@/lib/time";

// Phones and tablets (below the wide layout): a bar of five pages at the bottom, the day you're on at the top
// (tap it for the month), and the week as a strip of days above the calendar.

export type Tab = "today" | "priorities" | "mail" | "todo" | "calendar";

export const TAB_TITLE: Record<Exclude<Tab, "calendar">, string> = { today: "Today", priorities: "Priorities", mail: "Email", todo: "To-do" };

// The "liquid" spring: quick, with a little overshoot that settles, so highlights and pages flow rather than snap.
export const LIQUID = { type: "spring", stiffness: 380, damping: 28, mass: 0.8 } as const;
// A page or a stretch of days flowing in from the side you moved towards (dir 1: next / to the right, -1: back),
// leaning into the move like something dragged; dir 0 just fades in.
export const FLOW = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 64, skewX: dir * -3, scale: dir ? 1 : 0.985 }),
  center: { opacity: 1, x: 0, skewX: 0, scale: 1 },
  exit: (dir: number) => ({ opacity: 0, x: dir * -64, skewX: dir * 3, scale: dir ? 1 : 0.985 }),
};
export const FLOW_SPRING = { type: "spring", stiffness: 260, damping: 26, mass: 0.9 } as const;

// The two edges of the liquid highlight: the one in the direction of travel races ahead, the other follows.
const LEAD = { type: "spring", stiffness: 520, damping: 38, mass: 0.7 } as const;
const TRAIL = { type: "spring", stiffness: 170, damping: 20, mass: 1 } as const;

// A highlight that flows like liquid to whatever `target` is (any element inside this one's positioned parent): its
// front edge races to the new item while the back edge lags, so it stretches across the gap, thinning a little as it
// does, then gathers at the new item with a soft wobble. Jumps without moving when "reduce motion" is on.
export function LiquidBlob({ target, className }: { target: HTMLElement | null; className: string }) {
  const self = useRef<HTMLSpanElement>(null);
  const left = useMotionValue(0);
  const right = useMotionValue(0);
  const top = useMotionValue(0);
  const height = useMotionValue(0);
  const rest = useMotionValue(1); // its width when it's still, to tell how stretched it is
  const width = useTransform(() => right.get() - left.get());
  const scaleY = useTransform(() => 1 - Math.min(0.22, Math.max(0, width.get() / (rest.get() || 1) - 1) * 0.12));
  const placed = useRef(false);
  const calm = useReducedMotion();

  useLayoutEffect(() => {
    const parent = self.current?.offsetParent;
    if (!target || !parent) return;
    const place = (move: boolean) => {
      // Where the target is within the parent's padding box, which is what absolute positions count from.
      const t = target.getBoundingClientRect();
      const p = parent.getBoundingClientRect();
      const l = t.left - p.left - parent.clientLeft;
      const r = l + t.width;
      top.set(t.top - p.top - parent.clientTop);
      height.set(t.height);
      rest.set(t.width);
      if (!move || calm) {
        left.jump(l);
        right.jump(r);
        return;
      }
      const forward = l >= left.get();
      animate(left, l, forward ? TRAIL : LEAD);
      animate(right, r, forward ? LEAD : TRAIL);
    };
    place(placed.current);
    placed.current = true;
    const onResize = () => place(false);
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, [target, calm, left, right, top, height, rest]);

  if (!target) return null;
  return <motion.span ref={self} aria-hidden className={`pointer-events-none absolute ${className}`} style={{ left, width, top, height, scaleY }} />;
}

const icon = (children: ReactNode) => (
  <svg className="size-[21px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

const TABS: [Tab, string, ReactNode][] = [
  ["today", "Today", icon(<><rect x="4" y="4" width="16" height="16" rx="5" /><circle cx="17" cy="7" r="2.2" fill="currentColor" stroke="none" /></>)],
  ["priorities", "Priorities", icon(<path d="M5 21V4M5 4h11l-2 4 2 4H5" />)],
  ["mail", "Email", icon(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6.5 8.5 6 8.5-6" /></>)],
  ["todo", "To-do", icon(<path d="m4 7 2 2 3-3M4 15l2 2 3-3M12 8h8M12 16h8" />)],
  ["calendar", "Calendar", icon(<><rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>)],
];

export function BottomBar({ tab, onTab, open, mail, todayDot }: { tab: Tab; onTab: (t: Tab) => void; open: number; mail: number; todayDot: boolean }) {
  const [current, setCurrent] = useState<HTMLSpanElement | null>(null); // the spot under the tab you're on
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-20 flex h-[4.25rem] items-center justify-around rounded-[1.6rem] border border-line bg-surface px-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.14)] lg:hidden"
    >
      {/* A small red drop under the tab you're on, stretching like liquid to the next one you tap. */}
      <LiquidBlob target={current} className="rounded-full bg-accent" />
      {TABS.map(([id, label, svg]) => {
        const on = tab === id;
        const count = id === "priorities" ? open : id === "mail" ? mail : 0;
        return (
          <button
            key={id}
            type="button"
            aria-current={on ? "page" : undefined}
            onClick={() => onTab(id)}
            className={`relative flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 transition-colors duration-300 ${on ? "text-accent" : "text-muted"}`}
          >
            {on && <span ref={setCurrent} aria-hidden className="absolute bottom-0.5 left-1/2 h-1 w-5 -translate-x-1/2" />}
            <motion.span className="relative" animate={{ y: on ? -1.5 : 0, scale: on ? 1.08 : 1 }} transition={LIQUID}>
              {svg}
            </motion.span>
            <span className={`relative whitespace-nowrap text-[11px] ${on ? "font-semibold" : ""}`}>{label}</span>
            {/* What's still open in Priorities, and email finds waiting for an answer, in red. */}
            {/* Today: a plain red dot (no number) while it has a suggestion you haven't seen. */}
            {id === "today" && todayDot && (
              <span className="absolute left-1/2 top-1.5 ml-2 size-2.5 rounded-full ring-2 ring-surface" style={{ background: "var(--sev-critical)" }} aria-label="New suggestion" />
            )}
            {count > 0 && (
              <span className="absolute left-1/2 top-1 ml-1.5 grid min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold text-white ring-2 ring-surface" style={{ background: "var(--sev-critical)" }}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

const DAY = 86_400_000;
const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-IN", o);

// "Tomorrow / 13 Nov Friday ⌄": the day being shown. Tapping it opens the month.
export function DateButton({ day, now, open, onToggle }: { day: Date; now: Date; open: boolean; onToggle: () => void }) {
  const diff = Math.round((+startOfDay(day) - +startOfDay(now)) / DAY);
  const rel = diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : diff === -1 ? "Yesterday" : diff > 0 ? `In ${diff} days` : `${-diff} days ago`;
  const year = day.getFullYear() !== now.getFullYear() ? ` ${day.getFullYear()}` : "";
  return (
    <button type="button" aria-expanded={open} onClick={onToggle} aria-label={`${rel}, ${fmt(day, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}. Show the month`} className="min-w-0 flex-1 py-1 text-left">
      <span className="block text-xs text-muted">{rel}</span>
      <span className="mt-0.5 flex items-center gap-1.5">
        <span className="shrink-0 font-serif text-[1.85rem] leading-none">{fmt(day, { day: "numeric", month: "short" })}</span>
        <span className="truncate text-[15px] text-muted">
          {fmt(day, { weekday: "long" })}
          {year}
        </span>
        <svg className={`size-[18px] shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </span>
    </button>
  );
}

type Load = (from: Date, to: Date) => Promise<Ev[]>;

// The colours under each day: one dot per calendar with something on that day, up to three. Reloaded when the
// range or the calendar (version) changes.
function useDots(from: Date, to: Date, load: Load, color: (e: Ev) => string, version: number) {
  const [dots, setDots] = useState<Map<number, string[]>>(new Map());
  useEffect(() => {
    let live = true;
    load(from, to)
      .then((events) => {
        const m = new Map<number, string[]>();
        for (const e of events) {
          const k = +startOfDay(parseWhen(e.start, e.allDay));
          const c = color(e);
          const list = m.get(k) ?? [];
          if (list.length < 3 && !list.includes(c)) m.set(k, [...list, c]);
        }
        if (live) setDots(m);
      })
      .catch(() => {}); // no dots, the days still work
    return () => void (live = false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per range shown
  }, [+from, +to, version]);
  return dots;
}

const Dots = ({ colors }: { colors?: string[] }) => (
  <span className="flex h-[5px] gap-[3px]" aria-hidden>
    {colors?.map((c) => <span key={c} className="size-[5px] rounded-full" style={{ background: c }} />)}
  </span>
);

// Mon to Sun of the week being shown; tap a day to go to it.
// Handlers for a swipe, as the calendar's own (calendar-app.tsx): with a finger, a quick, mostly sideways stroke (not
// a tap or a scroll); on a laptop's trackpad, two fingers sideways. by: 1 for a swipe to the left (next), -1 to the
// right (previous).
function useSwipe(onSwipe: (by: 1 | -1) => void) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const wheel = useRef({ dx: 0, last: 0, until: 0 });
  return {
    onWheel: (e: React.WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      const w = wheel.current;
      const t = Date.now();
      // After a change, wait for the trackpad's glide to stop before the next one.
      if (t < w.until) return void (w.until = t + 300);
      if (t - w.last > 250) w.dx = 0;
      w.last = t;
      w.dx += e.deltaX;
      if (Math.abs(w.dx) < 120) return;
      onSwipe(w.dx > 0 ? 1 : -1);
      w.dx = 0;
      w.until = t + 300;
    },
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      start.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY, t: Date.now() } : null;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const s = start.current;
      start.current = null;
      const t = e.changedTouches[0];
      if (!s || !t) return;
      const dx = t.clientX - s.x;
      if (Math.abs(dx) > 50 && Math.abs(dx) > 2 * Math.abs(t.clientY - s.y) && Date.now() - s.t < 700) onSwipe(dx < 0 ? 1 : -1);
    },
  };
}

// Swiping it moves a week, to the same weekday.
export function WeekStrip({ day, now, onPick, load, color, version }: { day: Date; now: Date; onPick: (d: Date) => void; load: Load; color: (e: Ev) => string; version: number }) {
  const first = startOfWeek(day);
  const dots = useDots(first, addDays(first, 7), load, color, version);
  const swipe = useSwipe((by) => onPick(addDays(day, 7 * by)));
  // Another week flows in from its side, like the calendar's pages; a day picked in the same week doesn't move it.
  const [shown, setShown] = useState({ week: +first, dir: 0 });
  if (shown.week !== +first) setShown({ week: +first, dir: Math.sign(+first - shown.week) });
  return (
    <div className="relative -mx-1 mb-2" {...swipe}>
      <AnimatePresence mode="popLayout" custom={shown.dir} initial={false}>
        <motion.div key={shown.week} custom={shown.dir} variants={FLOW} initial="enter" animate="center" exit="exit" transition={FLOW_SPRING}>
          <WeekDays first={first} day={day} now={now} onPick={onPick} dots={dots} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// One week's seven days, with its own marker (so a week sliding out keeps its own).
function WeekDays({ first, day, now, onPick, dots }: { first: Date; day: Date; now: Date; onPick: (d: Date) => void; dots: Map<number, string[]> }) {
  const [picked, setPicked] = useState<HTMLSpanElement | null>(null);
  return (
    <div className="relative grid grid-cols-7">
      {/* The dark marker on the day you're on, flowing like liquid to the day you pick. */}
      <LiquidBlob target={picked} className="rounded-[11px] bg-ink" />
      {Array.from({ length: 7 }, (_, i) => addDays(first, i)).map((d) => {
        const here = +d === +startOfDay(day);
        const today = +d === +startOfDay(now);
        return (
          <button key={+d} type="button" onClick={() => onPick(d)} aria-pressed={here} aria-label={fmt(d, { weekday: "long", day: "numeric", month: "long" }) + (today ? ", today" : "")} className="flex flex-col items-center gap-1.5 pb-1">
            <span className={`border-b-2 pb-1 text-xs ${here ? "border-ink font-semibold" : "border-transparent text-muted"}`}>{fmt(d, { weekday: "short" })}</span>
            <span
              ref={here ? setPicked : undefined}
              className={`relative grid h-[34px] w-[38px] place-items-center rounded-[11px] text-[15px] transition-colors duration-300 ${here ? "font-medium text-paper" : today ? "font-semibold text-accent" : ""}`}
            >
              {d.getDate()}
            </span>
            <Dots colors={dots.get(+d)} />
          </button>
        );
      })}
    </div>
  );
}

// The whole month, opened in place of the week strip so it pushes the calendar down. A dot under each day with
// something on, in its calendar's colours.
export function MonthPanel({
  day,
  now,
  onPick,
  onClose,
  load,
  color,
}: {
  day: Date;
  now: Date;
  onPick: (d: Date) => void;
  onClose: () => void;
  load: Load;
  color: (e: Ev) => string;
}) {
  const [month, setMonth] = useState(() => startOfMonth(day));
  // Tapping the title switches to the year: 12 months to pick from, the arrows change the year (null = the days).
  const [year, setYear] = useState<number | null>(null);
  const next = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const dots = useDots(month, next, load, color, 0);
  // The arrows, also by swiping: left for the next month (or year), right for the previous one. The new one flows in
  // from that side, like the calendar's own pages (dir; 0 when switching between the days and the year).
  const [dir, setDir] = useState(0);
  const step = (by: 1 | -1) => {
    setDir(by);
    if (year === null) setMonth(new Date(month.getFullYear(), month.getMonth() + by, 1));
    else setYear(year + by);
  };
  const swipe = useSwipe(step);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const lead = (month.getDay() + 6) % 7; // weeks start on Monday
  const count = new Date(next.getTime() - DAY).getDate();
  // lg: sizes are for wide screens, where it sits in a small bubble under the date title.
  const arrow = "grid size-11 lg:size-8 place-items-center rounded-full text-muted hover:bg-ink/5 hover:text-ink";

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      role="region"
      aria-label="Pick a day"
      className="-mx-1 overflow-hidden"
    >
      <div className="pb-3" {...swipe}>
        <div className="flex items-center justify-between px-1.5">
          <button
            type="button"
            aria-expanded={year !== null}
            aria-label={year === null ? `${fmt(month, { month: "long", year: "numeric" })}. Change the month or year` : `${year}. Back to the days`}
            onClick={() => (setDir(0), setYear(year === null ? month.getFullYear() : null))}
            className="rounded-lg font-serif text-2xl leading-none text-accent hover:opacity-80 lg:text-xl"
          >
            <span aria-live="polite">{year === null ? `${fmt(month, { month: "long" })}, ${month.getFullYear()}` : year}</span>
          </button>
          <div className="flex gap-0.5">
            <button
              type="button"
              aria-label={year === null ? "Previous month" : "Previous year"}
              onClick={() => step(-1)}
              className={arrow}
            >
              <svg className="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="m15 6-6 6 6 6" />
              </svg>
            </button>
            <button type="button" aria-label={year === null ? "Next month" : "Next year"} onClick={() => step(1)} className={arrow}>
              <svg className="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
          </div>
        </div>
        <div className="relative">
        <AnimatePresence mode="popLayout" custom={dir} initial={false}>
        <motion.div key={year ?? `m${+month}`} custom={dir} variants={FLOW} initial="enter" animate="center" exit="exit" transition={FLOW_SPRING}>
        {year !== null ? (
          <div className="mt-3 grid grid-cols-3 gap-1.5 px-1.5">
            {Array.from({ length: 12 }, (_, i) => new Date(year, i, 1)).map((m) => {
              const here = +m === +month;
              const thisMonth = m.getFullYear() === now.getFullYear() && m.getMonth() === now.getMonth();
              return (
                <button
                  key={+m}
                  type="button"
                  aria-pressed={here}
                  aria-label={fmt(m, { month: "long", year: "numeric" })}
                  onClick={() => (setDir(0), setMonth(m), setYear(null))}
                  className={`rounded-xl py-3 text-[15px] transition-colors lg:py-2 lg:text-[13px] ${here ? "bg-ink font-medium text-paper" : `hover:bg-ink/10 ${thisMonth ? "font-semibold text-accent" : ""}`}`}
                >
                  {fmt(m, { month: "short" })}
                </button>
              );
            })}
          </div>
        ) : (
        <div className="mt-2 grid grid-cols-7 gap-y-0.5">
          {["M", "T", "W", "T", "F", "S", "S"].map((w, i) => (
            <span key={i} className="py-1.5 text-center text-xs text-muted lg:py-1 lg:text-[11px]" aria-hidden>
              {w}
            </span>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <span key={`e${i}`} />
          ))}
          {Array.from({ length: count }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1)).map((d) => {
            const here = +d === +startOfDay(day);
            const today = +d === +startOfDay(now);
            return (
              <button key={+d} type="button" onClick={() => onPick(d)} aria-pressed={here} aria-label={fmt(d, { weekday: "long", day: "numeric", month: "long" }) + (today ? ", today" : "")} className="group flex h-[46px] flex-col items-center justify-center gap-[3px] lg:h-9 lg:gap-0.5">
                <span className={`grid size-[34px] place-items-center rounded-[11px] text-[15px] transition-colors lg:size-7 lg:rounded-[9px] lg:text-[13px] ${here ? "bg-ink font-medium text-paper" : `group-hover:bg-ink/10 ${today ? "font-semibold text-accent" : ""}`}`}>{d.getDate()}</span>
                <Dots colors={dots.get(+d)} />
              </button>
            );
          })}
        </div>
        )}
        </motion.div>
        </AnimatePresence>
        </div>
        <div className="mt-2.5 flex justify-end px-1.5">
          <button type="button" onClick={() => onPick(startOfDay(now))} className="rounded-full border border-line px-3.5 py-1.5 text-sm hover:border-ink/40 lg:px-3 lg:py-1 lg:text-xs">
            Today
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// Which way a tab is from another in the bottom bar: 1 to the right, -1 to the left.
export const tabDirection = (from: Tab, to: Tab) => Math.sign(TABS.findIndex(([t]) => t === to) - TABS.findIndex(([t]) => t === from));
