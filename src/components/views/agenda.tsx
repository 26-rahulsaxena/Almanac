"use client";
import { AnimatePresence, motion } from "motion/react";
import type { Ev } from "@/lib/calendar";
import type { Severity } from "@/lib/priority";
import { addDays, formatTime, myReply, overlapsDay, startOfDay } from "@/lib/time";
import { SeverityChip } from "../priorities-panel";

const ease = [0.22, 1, 0.36, 1] as const;

type Props = {
  days: Date[];
  events: Ev[];
  color: (e: Ev) => string;
  severityOf: (e: Ev) => Severity | undefined;
  now: Date;
  onOpen: (e: Ev) => void;
  showFree?: boolean;
};

// A day-by-day list. Also used for search results (showFree off, only days with matches).
export function Agenda({ days, events, color, severityOf, now, onOpen, showFree = true }: Props) {
  const today = startOfDay(now);
  return (
    <ol className="space-y-6">
      {days.map((day) => {
        const dayEvents = events.filter((e) => overlapsDay(e, day));
        return (
          <li key={+day}>
            <h2 className="flex items-baseline gap-3 border-b border-line pb-1.5">
              <span className="font-serif text-2xl">{dayLabel(day, today)}</span>
              <span className="font-mono text-xs text-muted">
                {day.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
              </span>
            </h2>
            <ul className="mt-2">
              <AnimatePresence initial={false}>
                {showFree && dayEvents.length === 0 && (
                  <motion.li key="free" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-1.5 text-sm text-muted">
                    Free all day
                  </motion.li>
                )}
                {dayEvents.map((e) => (
                  <motion.li
                    key={`${e.calendarId}:${e.id}`}
                    layout
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3, ease }}
                    className="overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => onOpen(e)}
                      className="my-1 flex w-full items-start gap-4 rounded-r-lg py-1.5 pl-3 text-left hover:bg-ink/[0.04]"
                      style={{ borderLeft: `3px ${e.busy ? "solid" : "dashed"} ${color(e)}` }}
                    >
                      <span className="w-28 shrink-0 pt-0.5 font-mono text-xs text-muted">{timeLabel(e, day)}</span>
                      <span className="min-w-0">
                        {severityOf(e) && (
                          <span className="mr-2 align-middle">
                            <SeverityChip severity={severityOf(e)!} />
                          </span>
                        )}
                        <span className={`font-medium ${myReply(e).className}`}>{e.title}</span>
                        {e.recurringEventId && <span className="ml-2 text-xs text-muted" aria-label="repeats">↻</span>}
                        {myReply(e).note && <span className="ml-2 text-xs text-muted">{myReply(e).note.slice(3)}</span>}
                        <Details e={e} />
                      </span>
                    </button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </li>
        );
      })}
    </ol>
  );
}

function Details({ e }: { e: Ev }) {
  const guests = e.attendees?.filter((a) => !a.self).length ?? 0;
  const parts = [e.location, e.meetLink && "Google Meet", guests > 0 && `${guests} guest${guests === 1 ? "" : "s"}`].filter(Boolean);
  return parts.length ? <span className="block truncate text-sm text-muted">{parts.join(" · ")}</span> : null;
}

function dayLabel(day: Date, today: Date) {
  const diff = Math.round((+day - +today) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return day.toLocaleDateString("en-IN", { weekday: "long" });
}

function timeLabel(e: Ev, day: Date) {
  if (e.allDay) return "All day";
  const start = new Date(e.start);
  const end = new Date(e.end);
  const startsToday = start >= day;
  const endsToday = end <= addDays(day, 1);
  if (!startsToday && !endsToday) return "All day";
  if (!startsToday) return `until ${formatTime(end)}`;
  return endsToday ? `${formatTime(start)} – ${formatTime(end)}` : `${formatTime(start)} →`;
}
