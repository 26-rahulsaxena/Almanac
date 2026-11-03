"use client";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { setHiddenCalendars, signInWithGoogle, signOutNow } from "@/app/actions";
import type { Cal, Ev } from "@/lib/calendar";
import { CATEGORIES, categoryHex } from "@/lib/categories";
import type { DeleteInput, SaveInput, Scope, SendUpdates } from "@/lib/recurrence";
import { addDays, atHour, parseWhen, startOfDay, startOfMonth, startOfWeek } from "@/lib/time";
import { draftFromEvent, draftFromSlot, EventPanel, type Form } from "./event-panel";
import { ThemeToggle } from "./theme-toggle";
import { Agenda } from "./views/agenda";
import { MonthGrid } from "./views/month-grid";
import { TimeGrid } from "./views/time-grid";

const ease = [0.22, 1, 0.36, 1] as const;
type View = "day" | "week" | "month" | "agenda";
const VIEWS: View[] = ["day", "week", "month", "agenda"];
const LENGTH: Record<View, number> = { day: 1, week: 7, month: 42, agenda: 14 };
const KEYS: Record<string, View> = { d: "day", w: "week", m: "month", a: "agenda" };

function rangeOf(view: View, anchor: Date) {
  const start = view === "week" ? startOfWeek(anchor) : view === "month" ? startOfWeek(startOfMonth(anchor)) : startOfDay(anchor);
  const days = Array.from({ length: LENGTH[view] }, (_, i) => addDays(start, i));
  return { from: start, to: addDays(start, LENGTH[view]), days };
}

function shift(view: View, anchor: Date, dir: number) {
  if (view === "month") return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
  return addDays(anchor, dir * LENGTH[view]);
}

function titleOf(view: View, anchor: Date, days: Date[]) {
  const f = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-IN", o);
  if (view === "day") return f(anchor, { weekday: "long", day: "numeric", month: "long" });
  if (view === "month") return f(anchor, { month: "long", year: "numeric" });
  return `${f(days[0], { day: "numeric", month: "short" })} – ${f(days.at(-1)!, { day: "numeric", month: "short", year: "numeric" })}`;
}

async function fetchEvents(params: Record<string, string>, calIds: string[], signal?: AbortSignal) {
  const q = new URLSearchParams(params);
  for (const id of calIds) q.append("cal", id);
  const r = await fetch(`/api/events?${q}`, { signal });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? "Couldn't load events");
  return body as Ev[];
}

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const UNDO_MS = 6000;

async function send(method: "POST" | "DELETE", body: object, keepalive = false) {
  const r = await fetch("/api/events", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive });
  if (r.ok) return;
  const error = (await r.json().catch(() => null))?.error;
  throw new Error(error === "reauth" ? "Google needs you to sign in again: sign out, then sign back in." : (error ?? "Something went wrong. Try again."));
}

// Whether a delete covers this event: one occurrence, the rest of a series, or the whole series.
function deletes(d: DeleteInput, e: Ev) {
  if (e.calendarId !== d.calendarId) return false;
  if (!d.recurringEventId || d.scope === "this") return e.id === d.id;
  if (e.recurringEventId !== d.recurringEventId) return false;
  return d.scope === "all" || +parseWhen(e.originalStart ?? e.start, e.allDay) >= +parseWhen(d.originalStart!, d.allDay);
}

// Dates depend on the viewer's clock and time zone, so the calendar only renders in the browser.
const useMounted = () => useSyncExternalStore(() => () => {}, () => true, () => false);

const slide = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 48, scale: dir ? 1 : 0.985 }),
  center: { opacity: 1, x: 0, scale: 1 },
  exit: (dir: number) => ({ opacity: 0, x: dir * -48, scale: dir ? 1 : 0.985 }),
};

export function CalendarApp({ name, calendars, hidden: initialHidden }: { name: string; calendars: Cal[]; hidden: string[] }) {
  const mounted = useMounted();
  const now = useNow();
  const [hidden, setHidden] = useState(() => new Set(initialHidden));
  const [view, setView] = useState<View>(() => {
    try {
      if (VIEWS.includes(localStorage.view)) return localStorage.view;
    } catch {}
    return typeof window !== "undefined" && window.innerWidth < 640 ? "day" : "week";
  });
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [dir, setDir] = useState(0);
  // Loaded ranges, kept while you browse. gen bumps when you come back to the tab, to refetch in the background.
  const [cache, setCache] = useState<Record<string, { events: Ev[]; gen: number }>>({});
  const [gen, setGen] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ q: string; events: Ev[] } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [panel, setPanel] = useState<{ form: Form; event?: Ev } | null>(null);
  // Deletes wait out the undo window before reaching Google, so Undo never has to recreate anything.
  const [pending, setPending] = useState<{ key: number; input: DeleteInput; title: string; timer: number }[]>([]);
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  const [cats, setCats] = useState<Set<string>>(() => new Set());

  const calIds = useMemo(() => calendars.map((c) => c.id), [calendars]);
  const colorOf = useMemo(() => new Map(calendars.map((c) => [c.id, c.color])), [calendars]);
  const color = useCallback((e: Ev) => categoryHex(e.colorId) ?? colorOf.get(e.calendarId) ?? "var(--muted)", [colorOf]);
  const writable = calendars.find((c) => c.primary && c.canEdit) ?? calendars.find((c) => c.canEdit);
  const { from, to, days } = useMemo(() => rangeOf(view, anchor), [view, anchor]);
  const key = `${+from}-${+to}`;
  const entry = cache[key];

  useEffect(() => {
    if (!mounted || entry?.gen === gen) return;
    const ctl = new AbortController();
    fetchEvents({ from: from.toISOString(), to: to.toISOString() }, calIds, ctl.signal)
      .then((events) => setCache((c) => ({ ...c, [key]: { events, gen } })))
      .catch((e: Error) => e.name !== "AbortError" && setError(e.message));
    return () => ctl.abort();
  }, [mounted, entry, gen, key, from, to, calIds]);

  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && setGen((g) => g + 1);
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const q = query.trim();
  const searching = q.length >= 2;
  useEffect(() => {
    if (!searching) return;
    const t = setTimeout(() => {
      const today = startOfDay(new Date());
      fetchEvents({ from: addDays(today, -365).toISOString(), to: addDays(today, 365).toISOString(), q }, calIds)
        .then((events) => setResults({ q, events }))
        .catch((e: Error) => setError(e.message));
    }, 300);
    return () => clearTimeout(t);
  }, [q, searching, calIds]);

  function changeView(v: View) {
    setDir(0);
    setView(v);
    try {
      localStorage.view = v;
    } catch {}
  }
  function go(d: number) {
    setDir(d);
    setAnchor((a) => shift(view, a, d));
  }
  function goToday() {
    setDir(0);
    setAnchor(startOfDay(new Date()));
  }
  function openDay(d: Date) {
    setDir(0);
    setView("day");
    setAnchor(d);
  }

  function mutate(fn: (events: Ev[]) => Ev[]) {
    setCache((c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { ...v, events: fn(v.events) }])));
  }

  function book(start: Date, end: Date) {
    if (writable) setPanel({ form: draftFromSlot(start, end, writable.id) });
  }

  // New event: the next half hour today, or 9 am on the day being viewed.
  function newEvent() {
    const half = 30 * 60_000;
    const start = +startOfDay(anchor) === +startOfDay(new Date()) ? new Date(Math.ceil(Date.now() / half) * half) : atHour(anchor, 9);
    book(start, new Date(+start + 2 * half));
  }

  async function saveEvent(input: SaveInput) {
    await send("POST", input);
    const changed = {
      title: input.title || "(No title)",
      start: input.start,
      end: input.end,
      allDay: input.allDay,
      colorId: input.colorId ?? undefined,
      location: input.location,
      description: input.description,
      ...(input.attendees && { attendees: input.attendees }),
    };
    // Move the edited block right away so it glides into place; the refetch brings Google's final version (and new events).
    if (input.id && (!input.recurringEventId || input.scope === "this")) {
      mutate((evs) => evs.map((e) => (e.id === input.id && e.calendarId === input.calendarId ? { ...e, ...changed } : e)));
    }
    setPanel(null);
    setGen((g) => g + 1);
  }

  function scheduleDelete(e: Ev, scope?: Scope, sendUpdates?: SendUpdates) {
    const input: DeleteInput = {
      calendarId: e.calendarId,
      id: e.id,
      recurringEventId: e.recurringEventId,
      originalStart: e.originalStart,
      scope,
      allDay: e.allDay,
      sendUpdates,
    };
    const key = Date.now();
    const timer = window.setTimeout(async () => {
      try {
        await send("DELETE", input);
        mutate((evs) => evs.filter((x) => !deletes(input, x)));
        setGen((g) => g + 1);
      } catch (err) {
        setError(`Couldn't delete “${e.title}”. ${(err as Error).message}`);
      }
      setPending((p) => p.filter((x) => x.key !== key));
    }, UNDO_MS);
    setPending((p) => [...p, { key, input, title: e.title, timer }]);
    setPanel(null);
  }

  function undo(key: number) {
    clearTimeout(pending.find((p) => p.key === key)?.timer);
    setPending((p) => p.filter((x) => x.key !== key));
  }

  // Closing the tab during the undo window still carries out the delete.
  useEffect(() => {
    const flush = () => {
      for (const p of pendingRef.current) {
        clearTimeout(p.timer);
        send("DELETE", p.input, true).catch(() => {});
      }
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (panel || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]")) return;
      if (KEYS[e.key]) changeView(KEYS[e.key]);
      else if (e.key === "t") goToday();
      else if (e.key === "n") newEvent();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function toggle(id: string) {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden(next);
    setHiddenCalendars([...next]).catch(() => setError("Couldn't save which calendars are shown."));
  }

  function toggleCat(id: string) {
    const next = new Set(cats);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCats(next);
  }

  const shown = useCallback(
    (e: Ev) =>
      !hidden.has(e.calendarId) && (cats.size === 0 || cats.has(e.colorId ?? "none")) && !pending.some((p) => deletes(p.input, e)),
    [hidden, cats, pending],
  );
  const visible = useMemo(
    () =>
      (entry?.events ?? [])
        .filter(shown)
        .sort((a, b) => +parseWhen(a.start, a.allDay) - +parseWhen(b.start, b.allDay) || Number(b.allDay) - Number(a.allDay)),
    [entry, shown],
  );
  const found = results?.q === q ? results.events.filter(shown) : null;
  const openEvent = (e: Ev) => setPanel({ form: draftFromEvent(e), event: e });
  const foundDays = useMemo(() => {
    const seen = new Map<number, Date>();
    for (const e of found ?? []) {
      const d = startOfDay(parseWhen(e.start, e.allDay));
      seen.set(+d, d);
    }
    return [...seen.values()].sort((a, b) => +a - +b);
  }, [found]);

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-8">
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

      <div className="mx-auto grid w-full max-w-7xl flex-1 gap-6 px-4 py-5 sm:px-8 lg:grid-cols-[14rem_1fr]">
        <aside aria-label="Calendars">
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Calendars</h2>
          <ul className="mt-3 flex flex-wrap gap-2 lg:flex-col lg:gap-0.5">
            {calendars.map((c, i) => {
              const on = !hidden.has(c.id);
              return (
                <motion.li key={c.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04, ease }}>
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

          <h2 className="mt-6 font-mono text-xs uppercase tracking-[0.2em] text-muted">Categories</h2>
          <div role="group" aria-label="Filter by category" className="mt-3 flex flex-wrap gap-2">
            {[{ id: "none", name: "No category", hex: "" }, ...CATEGORIES].map((c) => {
              const on = cats.has(c.id);
              return (
                <motion.button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  aria-label={`Only show ${c.name}`}
                  title={c.name}
                  onClick={() => toggleCat(c.id)}
                  whileTap={{ scale: 0.85 }}
                  className={`size-6 rounded-full transition ${on ? "scale-110 ring-2 ring-ink ring-offset-2 ring-offset-paper" : cats.size ? "opacity-30" : ""} ${c.hex ? "" : "border-2 border-dashed border-muted"}`}
                  style={{ background: c.hex || "transparent" }}
                />
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted">
            {cats.size ? (
              <>
                Only {[...cats].map((id) => CATEGORIES.find((c) => c.id === id)?.name ?? "no category").join(", ")}.{" "}
                <button type="button" onClick={() => setCats(new Set())} className="text-ink underline">
                  Show all
                </button>
              </>
            ) : (
              "Pick colours to filter."
            )}
          </p>

          <p className="mt-6 hidden text-xs leading-relaxed text-muted lg:block">
            Keys: <kbd>N</kbd> new · <kbd>D</kbd> <kbd>W</kbd> <kbd>M</kbd> <kbd>A</kbd> views · <kbd>T</kbd> today · <kbd>←</kbd> <kbd>→</kbd> move · <kbd>/</kbd> search
          </p>
        </aside>

        <main className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <motion.button
                type="button"
                onClick={newEvent}
                disabled={!writable}
                whileTap={{ scale: 0.95 }}
                className="mr-1 rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-paper disabled:opacity-40"
              >
                + New
              </motion.button>
              <button type="button" onClick={goToday} className="rounded-full border border-line px-4 py-1.5 text-sm hover:border-ink/40">
                Today
              </button>
              <NavButton label="Previous" onClick={() => go(-1)} d="M15 18l-6-6 6-6" />
              <NavButton label="Next" onClick={() => go(1)} d="M9 6l6 6-6 6" />
            </div>
            <h1 className="order-last w-full font-serif text-3xl sm:order-none sm:mr-auto sm:w-auto sm:text-4xl" aria-live="polite">
              {mounted ? titleOf(view, anchor, days) : " "}
            </h1>
            <label className="ml-auto sm:ml-0">
              <span className="sr-only">Search events</span>
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && (setQuery(""), e.currentTarget.blur())}
                placeholder="Search   /"
                className="w-36 rounded-full border border-line bg-surface px-4 py-1.5 text-sm placeholder:text-muted focus:w-56 focus:outline-none focus:ring-2 focus:ring-accent/50 sm:w-44 motion-safe:transition-[width]"
              />
            </label>
            <div className="relative flex rounded-full border border-line bg-surface p-0.5" role="group" aria-label="View">
              {VIEWS.map((v) => {
                const on = mounted && view === v; // the saved view is only known in the browser
                return (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={on}
                    onClick={() => changeView(v)}
                    title={`${v} (${v[0].toUpperCase()})`}
                    className="relative rounded-full px-3 py-1 text-sm capitalize"
                  >
                    {on && (
                      <motion.span layoutId="view-pill" className="absolute inset-0 rounded-full bg-ink" transition={{ type: "spring", bounce: 0.2, duration: 0.4 }} />
                    )}
                    <span className={`relative ${on ? "text-paper" : ""}`}>{v}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {error === "reauth" ? (
            <Notice text="Google needs you to sign in again before it shares your calendar.">
              <form action={signInWithGoogle}>
                <button type="submit" className="mt-3 rounded-full bg-ink px-4 py-2 text-sm text-paper">
                  Sign in again
                </button>
              </form>
            </Notice>
          ) : (
            error && <Notice text={error} onClose={() => setError(null)} />
          )}

          <div className="relative mt-4">
            {mounted && !searching && !entry && (
              <motion.div
                className="absolute inset-x-4 -top-2 z-10 h-0.5 origin-left rounded-full bg-accent"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 0.85 }}
                transition={{ duration: 2.5, ease: "easeOut" }}
                aria-label="Loading events"
              />
            )}
            {!mounted ? null : searching ? (
              <section aria-live="polite">
                <p className="mb-4 text-sm text-muted">
                  {found ? `${found.length} result${found.length === 1 ? "" : "s"} for “${q}” in the past and next year` : `Searching for “${q}”…`}
                </p>
                {found && <Agenda days={foundDays} events={found} color={color} now={now} onOpen={openEvent} showFree={false} />}
              </section>
            ) : (
              <div className="overflow-hidden">
                <AnimatePresence mode="popLayout" custom={dir} initial={false}>
                  <motion.div
                    key={`${view}:${key}`}
                    custom={dir}
                    variants={slide}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.35, ease }}
                  >
                    {view === "month" ? (
                      <MonthGrid days={days} month={anchor.getMonth()} events={visible} color={color} now={now} onPickDay={openDay} />
                    ) : view === "agenda" ? (
                      <Agenda days={days} events={visible} color={color} now={now} onOpen={openEvent} />
                    ) : (
                      <TimeGrid
                        days={days}
                        events={visible}
                        color={color}
                        now={now}
                        onPickDay={openDay}
                        onOpen={openEvent}
                        onBook={writable ? book : undefined}
                      />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            )}
          </div>
        </main>
      </div>

      <AnimatePresence>
        {panel && (
          <EventPanel
            key="panel"
            initial={panel.form}
            event={panel.event}
            calendars={calendars}
            onClose={() => setPanel(null)}
            onSave={saveEvent}
            onDelete={(scope, send) => scheduleDelete(panel.event!, scope, send)}
          />
        )}
      </AnimatePresence>

      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex flex-col items-center gap-2 px-4">
        <AnimatePresence>
          {pending.map((p) => (
            <motion.div
              key={p.key}
              layout
              initial={{ y: 40, opacity: 0, scale: 0.95 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 20, opacity: 0, scale: 0.95 }}
              transition={{ type: "spring", damping: 26, stiffness: 380 }}
              className="pointer-events-auto relative flex w-full max-w-sm items-center gap-3 overflow-hidden rounded-2xl bg-ink px-4 py-3 text-sm text-paper shadow-xl"
            >
              <span className="min-w-0 flex-1 truncate">Deleted “{p.title}”</span>
              <button type="button" onClick={() => undo(p.key)} className="rounded-full bg-paper/15 px-3 py-1 font-medium hover:bg-paper/25">
                Undo
              </button>
              <motion.span
                className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-accent"
                initial={{ scaleX: 1 }}
                animate={{ scaleX: 0 }}
                transition={{ duration: UNDO_MS / 1000, ease: "linear" }}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function NavButton({ label, onClick, d }: { label: string; onClick: () => void; d: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="grid size-8 place-items-center rounded-full hover:bg-ink/5">
      <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d={d} />
      </svg>
    </button>
  );
}

function Notice({ text, children, onClose }: { text: string; children?: React.ReactNode; onClose?: () => void }) {
  return (
    <div role="alert" className="mt-4 flex max-w-lg items-start justify-between gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm">
      <div>
        {text}
        {children}
      </div>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Dismiss" className="text-muted hover:text-ink">
          ✕
        </button>
      )}
    </div>
  );
}
