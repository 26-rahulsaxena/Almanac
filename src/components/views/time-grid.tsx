"use client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { Ev } from "@/lib/calendar";
import type { Severity } from "@/lib/priority";
import { SEVERITY_LABEL, sevColor } from "../priorities-panel";
import {
  addDays,
  bookableWindow,
  busyIntervals,
  formatTime,
  freeSlots,
  layoutColumns,
  myReply,
  overlapsDay,
  parseWhen,
  startOfDay,
  type Interval,
} from "@/lib/time";

const HOUR = 48; // px per hour
const QUARTER = 15 * 60_000;
const ease = [0.22, 1, 0.36, 1] as const;
const hourLines = `repeating-linear-gradient(to bottom, var(--line) 0 1px, transparent 1px ${HOUR}px)`;

// A to-do being dragged in from the menu, onto a time.
export type TodoDrag = { id: string; title: string; minutes: number; x: number; y: number };

// What's being dragged and where it would land: column index and minutes after midnight, snapped to 15 minutes.
type Drag = {
  kind: "move" | "resize" | "todo";
  ev?: Ev;
  title: string;
  color: string;
  minutes: number; // length
  grab: number; // minutes between the block's start and the point where it was picked up
  day: number; // resize: the event's own column
  start: number; // resize: the event's own start
  at: { day: number; start: number; end: number } | null;
  x: number;
  y: number;
};

type Props = {
  days: Date[];
  events: Ev[];
  color: (e: Ev) => string;
  severityOf: (e: Ev) => Severity | undefined;
  now: Date;
  onPickDay: (d: Date) => void;
  onOpen: (e: Ev) => void;
  onBook?: (start: Date, end: Date) => void; // missing when no calendar can be written to
  canDrag?: (e: Ev) => boolean;
  onMove?: (e: Ev, start: Date, end: Date) => void;
  todoDrag?: TodoDrag | null;
  onTodoDrop?: (start: Date | null) => void;
};

const minutesInto = (d: Date) => d.getHours() * 60 + d.getMinutes();
const snap = (m: number) => Math.round(m / 15) * 15;
const at = (day: Date, minutes: number) => {
  const d = new Date(day);
  d.setMinutes(minutes);
  return d;
};

// Day view (1 column) and week view (7 columns). Events can be dragged to a new time or day, and stretched from
// their bottom edge; to-dos can be dropped in from the menu. On touch screens, press and hold to pick up.
export function TimeGrid({ days, events, color, severityOf, now, onPickDay, onOpen, onBook, canDrag, onMove, todoDrag, onTodoDrop }: Props) {
  const cols = `3.5rem repeat(${days.length}, minmax(0, 1fr))`;
  const today = +startOfDay(now);
  const allDay = events.filter((e) => e.allDay);
  const timed = events.filter((e) => !e.allDay);
  const scroller = useRef<HTMLDivElement | null>(null);
  const columns = useRef<(HTMLDivElement | null)[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const justDragged = useRef(false);

  // Open scrolled to an hour before now when today is visible, else 7 am.
  const scrollOnce = (el: HTMLDivElement | null) => {
    scroller.current = el;
    if (!el || el.dataset.scrolled) return;
    el.dataset.scrolled = "1";
    el.scrollTop = (days.some((d) => +d === today) ? Math.max(0, now.getHours() - 1) : 7) * HOUR;
  };

  // Where a drag would land for the pointer at (x, y).
  function land(d: Drag, x: number, y: number): Drag["at"] {
    const i = d.kind === "resize" ? d.day : columns.current.findIndex((c) => c && x >= c.getBoundingClientRect().left && x < c.getBoundingClientRect().right);
    const col = columns.current[i];
    if (!col) return null;
    const pointer = ((y - col.getBoundingClientRect().top) / HOUR) * 60;
    if (d.kind === "resize") return { day: i, start: d.start, end: Math.min(1440, Math.max(d.start + 15, snap(pointer))) };
    const start = Math.min(1440 - d.minutes, Math.max(0, snap(pointer - d.grab)));
    return { day: i, start, end: start + d.minutes };
  }

  // Follows the pointer until it's released: updates the preview, scrolls near the edges, then drops.
  // Escape cancels. While dragging on a touch screen, the page doesn't scroll.
  function follow(first: Drag, drop: (d: Drag) => void, cancel: () => void) {
    let d = { ...first, at: land(first, first.x, first.y) };
    let done = false;
    requestAnimationFrame(() => !done && setDrag((now) => now ?? d)); // listeners first, so a quick release isn't missed
    const move = (e: PointerEvent) => {
      d = { ...d, x: e.clientX, y: e.clientY, at: land(d, e.clientX, e.clientY) };
      setDrag(d);
      const box = scroller.current?.getBoundingClientRect();
      if (box && scroller.current) {
        if (e.clientY < box.top + 40) scroller.current.scrollTop -= 14;
        else if (e.clientY > box.bottom - 40) scroller.current.scrollTop += 14;
      }
    };
    const stop = (dropIt: boolean) => {
      done = true;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", abort);
      window.removeEventListener("keydown", key);
      window.removeEventListener("touchmove", noScroll);
      setDrag(null);
      setTimeout(() => (justDragged.current = false)); // after the click that may follow the release
      if (dropIt) drop(d);
      else cancel();
    };
    const up = () => stop(true);
    const abort = () => stop(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && stop(false);
    const noScroll = (e: TouchEvent) => e.preventDefault();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", abort);
    window.addEventListener("keydown", key);
    window.addEventListener("touchmove", noScroll, { passive: false });
  }

  // Picking up an event: a mouse drag starts after a few pixels (so a click still opens it); a finger has to
  // press and hold, so swiping still scrolls the calendar.
  function pickUp(pe: React.PointerEvent, e: Ev, kind: "move" | "resize", dayIndex: number) {
    if (pe.button !== 0 || !onMove || !canDrag?.(e)) return;
    const x0 = pe.clientX;
    const y0 = pe.clientY;
    const touch = pe.pointerType === "touch";
    const s = parseWhen(e.start, false);
    const en = parseWhen(e.end, false);
    const col = columns.current[dayIndex];
    const pointer = col ? ((y0 - col.getBoundingClientRect().top) / HOUR) * 60 : minutesInto(s);
    const base: Drag = {
      kind,
      ev: e,
      title: e.title,
      color: color(e),
      minutes: Math.max(15, Math.round((+en - +s) / 60_000)),
      grab: pointer - minutesInto(s),
      day: dayIndex,
      start: minutesInto(s),
      at: null,
      x: x0,
      y: y0,
    };
    let timer = 0;
    let last = { x: x0, y: y0 };
    const begin = () => {
      cleanup();
      justDragged.current = true; // the click that follows a drag must not open the event
      follow(
        { ...base, ...last },
        (d) => {
          if (!d.at) return;
          const start = at(days[d.at.day], d.at.start);
          const end = at(days[d.at.day], d.at.end);
          if (+start !== +s || +end !== +en) onMove(e, start, end);
        },
        () => {},
      );
    };
    const move = (m: PointerEvent) => {
      last = { x: m.clientX, y: m.clientY };
      const far = Math.hypot(m.clientX - x0, m.clientY - y0);
      if (!touch && far > 4) begin();
      else if (touch && far > 8) cleanup(); // it's a scroll
    };
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
    };
    if (touch) timer = window.setTimeout(begin, 350);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
  }

  // A to-do dragged in from the menu: follow it straight away.
  const todoId = todoDrag?.id;
  useEffect(() => {
    if (!todoDrag || !onTodoDrop) return;
    follow(
      { kind: "todo", title: todoDrag.title, color: "var(--accent)", minutes: todoDrag.minutes, grab: 0, day: 0, start: 0, at: null, x: todoDrag.x, y: todoDrag.y },
      (d) => onTodoDrop(d.at ? at(days[d.at.day], d.at.start) : null),
      () => onTodoDrop(null),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per to-do picked up
  }, [todoId]);

  return (
    <div className={`overflow-hidden rounded-2xl border border-line bg-surface ${drag ? "cursor-grabbing select-none" : ""}`}>
      <div className="grid border-b border-line" style={{ gridTemplateColumns: cols }}>
        <div />
        {days.map((d) => (
          <button
            key={+d}
            type="button"
            onClick={() => onPickDay(d)}
            disabled={days.length === 1}
            className="flex flex-col items-center gap-0.5 border-l border-line py-2 hover:bg-ink/[0.03] disabled:hover:bg-transparent"
          >
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
              {d.toLocaleDateString("en-IN", { weekday: "short" })}
            </span>
            <span className={`grid size-8 place-items-center rounded-full font-serif text-xl ${+d === today ? "bg-accent text-paper" : ""}`}>
              {d.getDate()}
            </span>
          </button>
        ))}
      </div>

      <div className="grid border-b border-line" style={{ gridTemplateColumns: cols }}>
        <span className="self-center pr-2 text-right font-mono text-[10px] text-muted">all day</span>
        {days.map((d) => (
          <div key={+d} className="min-h-7 space-y-0.5 border-l border-line p-0.5">
            <AnimatePresence initial={false}>
              {allDay
                .filter((e) => overlapsDay(e, d))
                .map((e) => (
                  <motion.button
                    key={`${e.calendarId}:${e.id}`}
                    type="button"
                    layout
                    onClick={() => onOpen(e)}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium hover:brightness-95"
                    style={{ background: `color-mix(in srgb, ${color(e)} 28%, var(--surface))` }}
                    title={e.title}
                  >
                    <Flag severity={severityOf(e)} />
                    {e.title}
                  </motion.button>
                ))}
            </AnimatePresence>
          </div>
        ))}
      </div>

      <div ref={scrollOnce} className="max-h-[max(24rem,calc(100dvh-17rem))] overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: cols, height: 24 * HOUR }}>
          <div className="relative">
            {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
              <span key={h} className="absolute right-2 -translate-y-1/2 font-mono text-[10px] text-muted" style={{ top: h * HOUR }}>
                {formatTime(new Date(2000, 0, 1, h)).replace(":00", "")}
              </span>
            ))}
          </div>
          {days.map((d, i) => (
            <DayColumn
              key={+d}
              colRef={(el) => {
                columns.current[i] = el;
              }}
              day={d}
              index={i}
              events={timed.filter((e) => overlapsDay(e, d))}
              color={color}
              severityOf={severityOf}
              now={now}
              onOpen={(e) => {
                if (justDragged.current) justDragged.current = false;
                else onOpen(e);
              }}
              onBook={drag ? undefined : onBook}
              canDrag={onMove ? canDrag : undefined}
              pickUp={pickUp}
              drag={drag}
            />
          ))}
        </div>
      </div>

      {/* A to-do that isn't over the calendar yet follows the pointer as a chip. */}
      {drag?.kind === "todo" && !drag.at && (
        <div
          className="pointer-events-none fixed z-[80] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent px-3 py-1 text-sm font-medium text-white shadow-xl"
          style={{ left: drag.x, top: drag.y }}
        >
          {drag.title}
        </div>
      )}
    </div>
  );
}

// Booking from a click inside a free slot: start at the clicked quarter hour, one hour long, kept inside the slot.
function pickTime(slot: Interval, offsetPx: number): [Date, Date] {
  const at = +slot.start + Math.max(0, Math.floor(((offsetPx / HOUR) * 3_600_000) / QUARTER) * QUARTER);
  const start = Math.min(at, +slot.end - 2 * QUARTER);
  return [new Date(start), new Date(Math.min(start + 4 * QUARTER, +slot.end))];
}

type ColumnProps = Omit<Props, "days" | "onPickDay" | "onMove" | "todoDrag" | "onTodoDrop"> & {
  day: Date;
  index: number;
  colRef: (el: HTMLDivElement | null) => void;
  pickUp: (pe: React.PointerEvent, e: Ev, kind: "move" | "resize", dayIndex: number) => void;
  drag: Drag | null;
};

// A deadline's severity: coloured dot plus its name for screen readers and on hover.
function Flag({ severity }: { severity?: Severity }) {
  if (!severity) return null;
  return (
    <span
      className="mr-1 inline-block size-2 rounded-full align-middle ring-2 ring-surface"
      style={{ background: sevColor(severity) }}
      role="img"
      aria-label={`${SEVERITY_LABEL[severity]} deadline`}
      title={`${SEVERITY_LABEL[severity]} deadline`}
    />
  );
}

function DayColumn({ day, index, colRef, events, color, severityOf, now, onOpen, onBook, canDrag, pickUp, drag }: ColumnProps) {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const y = (d: Date) => ((+d - +dayStart) / 3_600_000) * HOUR;
  const clip = (d: Date) => (d < dayStart ? dayStart : d > dayEnd ? dayEnd : d);
  const win = bookableWindow(day, now);
  const free = win ? freeSlots(events, win.start, win.end, 30) : [];
  const busy = busyIntervals(events, dayStart, dayEnd);
  const preview = drag?.at?.day === index ? drag.at : null;

  return (
    <div ref={colRef} className="relative border-l border-line" style={{ backgroundImage: hourLines }}>
      {onBook &&
        free.map((s) => (
          <button
            key={+s.start}
            type="button"
            onClick={(e) => {
              // Keyboard "clicks" have no pointer position; they book the start of the slot.
              const offset = e.detail === 0 ? 0 : e.clientY - e.currentTarget.getBoundingClientRect().top;
              onBook(...pickTime(s, offset));
            }}
            aria-label={`Book free time, ${formatTime(s.start)} to ${formatTime(s.end)}`}
            className="group absolute inset-x-1 rounded-lg border border-dashed border-transparent text-left transition-colors duration-200 hover:border-ink/25 hover:bg-[color-mix(in_srgb,var(--cat-2)_8%,transparent)] focus-visible:border-ink/40"
            style={{ top: y(s.start) + 1, height: y(s.end) - y(s.start) - 2 }}
          >
            <span className="pointer-events-none absolute left-2 top-1 translate-y-1 text-[11px] text-muted opacity-0 transition duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:opacity-100">
              + Book · free {formatTime(s.start)} – {formatTime(s.end)}
            </span>
          </button>
        ))}

      {busy.map((b) => (
        <div
          key={+b.start}
          className="pointer-events-none absolute left-0 w-1 rounded-r bg-ink/30"
          style={{ top: y(b.start), height: y(b.end) - y(b.start) }}
          title={`Busy ${formatTime(b.start)} – ${formatTime(b.end)}`}
        />
      ))}

      <AnimatePresence initial={false}>
        {layoutColumns(events).map(({ event: e, col, cols }, i) => {
          const s = clip(parseWhen(e.start, false));
          const en = clip(parseWhen(e.end, false));
          const h = y(en) - y(s);
          const c = color(e);
          const reply = myReply(e);
          const sev = severityOf(e);
          // Only events that start and end on this day can be dragged (not ones running past midnight).
          const movable = !!canDrag?.(e) && +s === +parseWhen(e.start, false) && +en === +parseWhen(e.end, false);
          const dragging = drag?.ev?.id === e.id && drag.ev.calendarId === e.calendarId;
          return (
            <motion.button
              key={`${e.calendarId}:${e.id}`}
              type="button"
              onClick={() => onOpen(e)}
              onPointerDown={movable ? (pe) => pickUp(pe, e, "move", index) : undefined}
              onContextMenu={movable ? (ce) => ce.preventDefault() : undefined} // press-and-hold picks it up instead
              layout
              initial={{ opacity: 0, scaleY: 0.6 }}
              animate={{ opacity: dragging ? 0.35 : 1, scaleY: 1 }}
              exit={{ opacity: 0, scale: 0.85, filter: "blur(2px)" }}
              transition={{ duration: 0.35, delay: Math.min(i * 0.03, 0.3), ease }}
              className={`group absolute origin-top overflow-hidden rounded-md px-1.5 py-0.5 text-left text-xs leading-tight shadow-sm [-webkit-touch-callout:none] hover:brightness-95 ${movable ? "cursor-grab" : ""} ${reply.className}`}
              style={{
                top: y(s) + 1,
                height: Math.max(h - 2, 18),
                left: `calc(${(col / cols) * 100}% + 6px)`,
                width: `calc(${100 / cols}% - 8px)`,
                background: `color-mix(in srgb, ${c} 22%, var(--surface))`,
                borderLeft: `3px ${e.busy ? "solid" : "dashed"} ${c}`,
                outline: reply.dashed ? `1px dashed ${c}` : sev ? `2px solid ${sevColor(sev)}` : undefined,
                outlineOffset: -1,
              }}
              title={`${e.title} · ${formatTime(s)} – ${formatTime(en)}${e.busy ? "" : " · shown as free"}${reply.note}${movable ? " · drag to move, drag the bottom edge to change the length" : ""}`}
            >
              <p className="truncate font-medium">
                <Flag severity={sev} />
                {e.meetLink && (
                  <span className="mr-1" aria-label="has video call">
                    ▶
                  </span>
                )}
                {e.title}
                {e.recurringEventId && <span className="ml-1 text-muted" aria-label="repeats">↻</span>}
              </p>
              {h > 34 && (
                <p className="truncate text-muted">
                  {formatTime(s)} – {formatTime(en)}
                </p>
              )}
              {movable && (
                <span
                  aria-hidden
                  onPointerDown={(pe) => {
                    pe.stopPropagation();
                    pickUp(pe, e, "resize", index);
                  }}
                  className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize after:absolute after:bottom-0.5 after:left-1/2 after:h-0.5 after:w-6 after:-translate-x-1/2 after:rounded after:bg-ink/30 after:opacity-0 group-hover:after:opacity-100"
                />
              )}
            </motion.button>
          );
        })}
      </AnimatePresence>

      {preview && drag && (
        <div
          className="pointer-events-none absolute inset-x-1 z-20 rounded-md border-2 border-dashed px-1.5 py-0.5 text-xs font-medium shadow-lg"
          style={{
            top: (preview.start / 60) * HOUR + 1,
            height: Math.max(((preview.end - preview.start) / 60) * HOUR - 2, 18),
            borderColor: drag.color,
            background: `color-mix(in srgb, ${drag.color} 30%, var(--surface))`,
          }}
        >
          <p className="truncate">{drag.title}</p>
          <p className="truncate font-normal text-muted">
            {formatTime(at(day, preview.start))} – {formatTime(at(day, preview.end))}
          </p>
        </div>
      )}

      {+dayStart === +startOfDay(now) && (
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.6, delay: 0.3, ease }}
          className="pointer-events-none absolute -left-1 right-0 z-10 h-0.5 origin-left bg-accent"
          style={{ top: y(now) }}
          aria-label={`Now, ${formatTime(now)}`}
        >
          <span className="absolute -left-1 -top-[5px] size-3 rounded-full bg-accent" />
        </motion.div>
      )}
    </div>
  );
}
