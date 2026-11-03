"use client";
import { motion } from "motion/react";
import type { Ev } from "@/lib/calendar";
import { atHour, busyIntervals, formatTime, FREE_FROM_HOUR, FREE_TO_HOUR, overlapsDay, parseWhen, startOfDay } from "@/lib/time";

type Props = { days: Date[]; month: number; events: Ev[]; colorOf: Map<string, string>; now: Date; onPickDay: (d: Date) => void };

export function MonthGrid({ days, month, events, colorOf, now, onPickDay }: Props) {
  const today = +startOfDay(now);
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="grid grid-cols-7 border-b border-line">
        {days.slice(0, 7).map((d) => (
          <span key={+d} className="py-2 text-center font-mono text-[10px] uppercase tracking-widest text-muted">
            {d.toLocaleDateString("en-IN", { weekday: "short" })}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const dayEvents = events.filter((e) => overlapsDay(e, d));
          const from = atHour(d, FREE_FROM_HOUR);
          const to = atHour(d, FREE_TO_HOUR);
          const span = +to - +from;
          const busy = busyIntervals(dayEvents, from, to);
          return (
            <motion.button
              key={+d}
              type="button"
              onClick={() => onPickDay(d)}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.008, duration: 0.3 }}
              aria-label={`${d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}, ${dayEvents.length} events`}
              className={`flex min-h-20 min-w-0 flex-col gap-1 border-b border-r border-line p-1 text-left transition-colors hover:bg-ink/[0.04] sm:min-h-28 sm:p-1.5 ${
                d.getMonth() === month ? "" : "bg-ink/[0.025] text-muted"
              }`}
            >
              <span className={`grid size-7 place-items-center rounded-full font-mono text-xs ${+d === today ? "bg-accent text-paper" : ""}`}>
                {d.getDate()}
              </span>
              {/* Busy bar: 8 am → 10 pm left to right; dark segments are busy time. */}
              <span className="relative h-1 w-full rounded-full bg-ink/5" aria-hidden>
                {busy.map((b) => (
                  <span
                    key={+b.start}
                    className="absolute inset-y-0 rounded-full bg-ink/45"
                    style={{ left: `${((+b.start - +from) / span) * 100}%`, width: `${((+b.end - +b.start) / span) * 100}%` }}
                  />
                ))}
              </span>
              <span className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                {dayEvents.slice(0, 3).map((e) => (
                  <span key={`${e.calendarId}:${e.id}`} className="flex min-w-0 items-center gap-1 text-[11px] leading-tight">
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: colorOf.get(e.calendarId) }} />
                    {!e.allDay && <span className="shrink-0 font-mono text-muted">{formatTime(parseWhen(e.start, false)).replace(" ", "")}</span>}
                    <span className="truncate">{e.title}</span>
                  </span>
                ))}
                {dayEvents.length > 3 && <span className="text-[11px] text-muted">+{dayEvents.length - 3} more</span>}
              </span>
              <span className="flex flex-wrap gap-0.5 sm:hidden" aria-hidden>
                {dayEvents.slice(0, 4).map((e) => (
                  <span key={`${e.calendarId}:${e.id}`} className="size-1.5 rounded-full" style={{ background: colorOf.get(e.calendarId) }} />
                ))}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
