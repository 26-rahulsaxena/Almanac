"use client";
import { AnimatePresence, motion } from "motion/react";
import type { Ev } from "@/lib/calendar";
import {
  addDays,
  bookableWindow,
  busyIntervals,
  formatTime,
  freeSlots,
  layoutColumns,
  overlapsDay,
  parseWhen,
  startOfDay,
  type Interval,
} from "@/lib/time";

const HOUR = 48; // px per hour
const QUARTER = 15 * 60_000;
const ease = [0.22, 1, 0.36, 1] as const;
const hourLines = `repeating-linear-gradient(to bottom, var(--line) 0 1px, transparent 1px ${HOUR}px)`;

type Props = {
  days: Date[];
  events: Ev[];
  color: (e: Ev) => string;
  now: Date;
  onPickDay: (d: Date) => void;
  onOpen: (e: Ev) => void;
  onBook?: (start: Date, end: Date) => void; // missing when no calendar can be written to
};

// Day view (1 column) and week view (7 columns).
export function TimeGrid({ days, events, color, now, onPickDay, onOpen, onBook }: Props) {
  const cols = `3.5rem repeat(${days.length}, minmax(0, 1fr))`;
  const today = +startOfDay(now);
  const allDay = events.filter((e) => e.allDay);
  const timed = events.filter((e) => !e.allDay);

  // Open scrolled to an hour before now when today is visible, else 7 am.
  const scrollOnce = (el: HTMLDivElement | null) => {
    if (!el || el.dataset.scrolled) return;
    el.dataset.scrolled = "1";
    el.scrollTop = (days.some((d) => +d === today) ? Math.max(0, now.getHours() - 1) : 7) * HOUR;
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
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
          {days.map((d) => (
            <DayColumn
              key={+d}
              day={d}
              events={timed.filter((e) => overlapsDay(e, d))}
              color={color}
              now={now}
              onOpen={onOpen}
              onBook={onBook}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// Booking from a click inside a free slot: start at the clicked quarter hour, one hour long, kept inside the slot.
function pickTime(slot: Interval, offsetPx: number): [Date, Date] {
  const at = +slot.start + Math.max(0, Math.floor(((offsetPx / HOUR) * 3_600_000) / QUARTER) * QUARTER);
  const start = Math.min(at, +slot.end - 2 * QUARTER);
  return [new Date(start), new Date(Math.min(start + 4 * QUARTER, +slot.end))];
}

type ColumnProps = Omit<Props, "days" | "onPickDay"> & { day: Date };

function DayColumn({ day, events, color, now, onOpen, onBook }: ColumnProps) {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const y = (d: Date) => ((+d - +dayStart) / 3_600_000) * HOUR;
  const clip = (d: Date) => (d < dayStart ? dayStart : d > dayEnd ? dayEnd : d);
  const win = bookableWindow(day, now);
  const free = win ? freeSlots(events, win.start, win.end, 30) : [];
  const busy = busyIntervals(events, dayStart, dayEnd);

  return (
    <div className="relative border-l border-line" style={{ backgroundImage: hourLines }}>
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
          return (
            <motion.button
              key={`${e.calendarId}:${e.id}`}
              type="button"
              onClick={() => onOpen(e)}
              layout
              initial={{ opacity: 0, scaleY: 0.6 }}
              animate={{ opacity: 1, scaleY: 1 }}
              exit={{ opacity: 0, scale: 0.85, filter: "blur(2px)" }}
              transition={{ duration: 0.35, delay: Math.min(i * 0.03, 0.3), ease }}
              className="absolute origin-top overflow-hidden rounded-md px-1.5 py-0.5 text-left text-xs leading-tight shadow-sm hover:brightness-95"
              style={{
                top: y(s) + 1,
                height: Math.max(h - 2, 18),
                left: `calc(${(col / cols) * 100}% + 6px)`,
                width: `calc(${100 / cols}% - 8px)`,
                background: `color-mix(in srgb, ${c} 22%, var(--surface))`,
                borderLeft: `3px ${e.busy ? "solid" : "dashed"} ${c}`,
              }}
              title={`${e.title} · ${formatTime(s)} – ${formatTime(en)}${e.busy ? "" : " · shown as free"}`}
            >
              <p className="truncate font-medium">
                {e.title}
                {e.recurringEventId && <span className="ml-1 text-muted" aria-label="repeats">↻</span>}
              </p>
              {h > 34 && (
                <p className="truncate text-muted">
                  {formatTime(s)} – {formatTime(en)}
                </p>
              )}
            </motion.button>
          );
        })}
      </AnimatePresence>

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
