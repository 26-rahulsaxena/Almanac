"use client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { setHiddenCalendars, signInWithGoogle, signOutNow } from "@/app/actions";
import type { Cal, Ev } from "@/lib/calendar";
import { addDays, overlapsDay, parseWhen, startOfDay } from "@/lib/time";
import { ThemeToggle } from "./theme-toggle";

const ease = [0.22, 1, 0.36, 1] as const;
const DAYS = 14;

export function CalendarApp({ name, calendars, hidden: initialHidden }: { name: string; calendars: Cal[]; hidden: string[] }) {
  const [hidden, setHidden] = useState(() => new Set(initialHidden));
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [error, setError] = useState<"reauth" | string | null>(null);
  const [today] = useState(() => startOfDay(new Date()));

  useEffect(() => {
    const q = new URLSearchParams({ from: today.toISOString(), to: addDays(today, DAYS).toISOString() });
    fetch(`/api/events?${q}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Couldn't load events");
        setEvents(body);
      })
      .catch((e: Error) => setError(e.message));
  }, [today]);

  function toggle(id: string) {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden(next);
    setHiddenCalendars([...next]).catch(() => setError("Couldn't save which calendars are shown."));
  }

  const colorOf = useMemo(() => new Map(calendars.map((c) => [c.id, c.color])), [calendars]);
  const days = useMemo(() => {
    const visible = (events ?? [])
      .filter((e) => !hidden.has(e.calendarId))
      .sort((a, b) => +parseWhen(a.start, a.allDay) - +parseWhen(b.start, b.allDay) || Number(b.allDay) - Number(a.allDay));
    return Array.from({ length: DAYS }, (_, i) => {
      const day = addDays(today, i);
      return { day, events: visible.filter((e) => overlapsDay(e, day)) };
    });
  }, [events, hidden, today]);

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-paper/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-8">
          <span className="font-serif text-2xl">Almanac</span>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-muted sm:inline">{name}</span>
            <ThemeToggle />
            <form action={signOutNow}>
              <button type="submit" className="rounded-full border border-line px-4 py-2 text-sm hover:border-ink/40">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-8 px-4 py-6 sm:px-8 lg:grid-cols-[15rem_1fr]">
        <aside aria-label="Calendars">
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Calendars</h2>
          <ul className="mt-3 flex flex-wrap gap-2 lg:flex-col lg:gap-0.5">
            {calendars.map((c, i) => {
              const on = !hidden.has(c.id);
              return (
                <motion.li
                  key={c.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04, ease }}
                >
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(c.id)}
                    className="flex w-full items-center gap-2.5 rounded-lg border border-line px-3 py-1.5 text-left text-sm hover:bg-ink/5 lg:border-transparent"
                  >
                    <span
                      className="grid size-4 shrink-0 place-items-center rounded-[5px] border-2 text-[10px] text-white transition-colors"
                      style={{ borderColor: c.color, background: on ? c.color : "transparent" }}
                      aria-hidden
                    >
                      {on && "✓"}
                    </span>
                    <span className={`truncate transition-opacity ${on ? "" : "opacity-50"}`}>{c.name}</span>
                  </button>
                </motion.li>
              );
            })}
          </ul>
        </aside>

        <main>
          <h1 className="font-serif text-4xl sm:text-5xl">Next two weeks</h1>
          {error === "reauth" ? (
            <Notice text="Google needs you to sign in again before it shares your calendar.">
              <form action={signInWithGoogle}>
                <button type="submit" className="mt-3 rounded-full bg-ink px-4 py-2 text-sm text-paper">
                  Sign in again
                </button>
              </form>
            </Notice>
          ) : (
            error && <Notice text={error} />
          )}

          {!events && !error ? (
            <Skeleton />
          ) : (
            <ol className="mt-6 space-y-6">
              {days.map(({ day, events }) => (
                <li key={day.toISOString()}>
                  <h2 className="flex items-baseline gap-3 border-b border-line pb-1.5">
                    <span className="font-serif text-2xl">{dayLabel(day, today)}</span>
                    <span className="font-mono text-xs text-muted">
                      {day.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
                    </span>
                  </h2>
                  <ul className="mt-2">
                    <AnimatePresence initial={false}>
                      {events.length === 0 && (
                        <motion.li
                          key="free"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="py-1.5 text-sm text-muted"
                        >
                          Free all day
                        </motion.li>
                      )}
                      {events.map((e) => (
                        <motion.li
                          key={`${e.calendarId}:${e.id}`}
                          layout
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.3, ease }}
                          className="overflow-hidden"
                        >
                          <div className="my-1 flex items-start gap-4 rounded-lg py-1.5 pl-3" style={{ borderLeft: `3px solid ${colorOf.get(e.calendarId)}` }}>
                            <span className="w-28 shrink-0 pt-0.5 font-mono text-xs text-muted">{timeLabel(e, day)}</span>
                            <span className="min-w-0">
                              <span className="font-medium">{e.title}</span>
                              {e.recurring && <span className="ml-2 text-xs text-muted" title="Repeats">↻</span>}
                              {e.location && <span className="block truncate text-sm text-muted">{e.location}</span>}
                            </span>
                          </div>
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </main>
      </div>
    </div>
  );
}

function dayLabel(day: Date, today: Date) {
  const diff = Math.round((+day - +today) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return day.toLocaleDateString("en-IN", { weekday: "long" });
}

const hm = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

function timeLabel(e: Ev, day: Date) {
  if (e.allDay) return "All day";
  const start = new Date(e.start);
  const end = new Date(e.end);
  const startsToday = start >= day;
  const endsToday = end <= addDays(day, 1);
  if (!startsToday && !endsToday) return "All day";
  if (!startsToday) return `until ${hm(end)}`;
  return endsToday ? `${hm(start)} – ${hm(end)}` : `${hm(start)} →`;
}

function Notice({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <div role="alert" className="mt-6 max-w-lg rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm">
      {text}
      {children}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="mt-6 space-y-3" aria-label="Loading events">
      {[0, 1, 2, 3].map((i) => (
        <motion.div
          key={i}
          className="h-10 rounded-lg bg-ink/5"
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </div>
  );
}
