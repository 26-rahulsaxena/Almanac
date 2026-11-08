"use client";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { setHiddenCalendars, signInWithGoogle, type AlertStages } from "@/app/actions";
import type { Cal, Ev } from "@/lib/calendar";
import { CATEGORIES, categoryHex } from "@/lib/categories";
import type { DeleteInput, SaveInput, Scope, SendUpdates } from "@/lib/recurrence";
import { addDays, atHour, formatTime, parseWhen, startOfDay, startOfMonth, startOfWeek } from "@/lib/time";
import { Assistant } from "./assistant";
import { FullScreenAlert } from "./full-screen-alert";
import { syncPush } from "./notify-settings";
import { draftFromEvent, draftFromSlot, draftMoved, EventPanel, type Form } from "./event-panel";
import type { Priority } from "@/lib/priorities";
import type { Severity } from "@/lib/priority";
import { Settings } from "./settings";
import { Welcome } from "./welcome";
import { CreateMenu } from "./create-menu";
import { AlertsBanner } from "./alerts-banner";
import { AwayDialog } from "./away-dialog";
import type { AwayKind } from "@/lib/away";
import { EMPTY_PROFILE, type Profile } from "@/lib/profile";
import { PrioritiesPanel, type PriorityAction } from "./priorities-panel";
import { Modal, Review, TodayCard, WhatNow } from "./coach";
import { QuickAdd } from "./quick-add";
import { Suggestions, type PlanMode } from "./suggestions";
import { ThemeToggle } from "./theme-toggle";
import { TodoDialog } from "./todo-dialog";
import { TodoList } from "./todo-list";
import { Agenda } from "./views/agenda";
import { MonthGrid } from "./views/month-grid";
import { TimeGrid, type TodoDrag } from "./views/time-grid";

const ease = [0.22, 1, 0.36, 1] as const;
type View = "day" | "week" | "month" | "agenda";
const VIEWS: View[] = ["agenda", "day", "week", "month"];
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
const SPLIT_DEFAULT = 70;
const SPLIT_MIN = 40;
const SPLIT_MAX = 80;

const useMounted = () => useSyncExternalStore(() => () => {}, () => true, () => false);

// Wide screens (lg and up) show Today and Priorities beside the calendar; phones open them from two buttons.
const WIDE = "(min-width: 1024px)";
const useWide = () =>
  useSyncExternalStore(
    (cb) => {
      const m = matchMedia(WIDE);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => matchMedia(WIDE).matches,
    () => true,
  );

const slide = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 48, scale: dir ? 1 : 0.985 }),
  center: { opacity: 1, x: 0, scale: 1 },
  exit: (dir: number) => ({ opacity: 0, x: dir * -48, scale: dir ? 1 : 0.985 }),
};

export function CalendarApp({
  name,
  calendars,
  hidden: initialHidden,
  stages,
  planMode,
  profile,
}: {
  name: string;
  calendars: Cal[];
  hidden: string[];
  stages: AlertStages;
  planMode: PlanMode;
  profile: Profile | null; // null: not asked yet, so the welcome pop-up shows
}) {
  const mounted = useMounted();
  const now = useNow();
  const [hidden, setHidden] = useState(() => new Set(initialHidden));
  const [view, setView] = useState<View>(() => {
    try {
      if (VIEWS.includes(localStorage.view)) return localStorage.view;
    } catch {}
    return typeof window !== "undefined" && window.innerWidth < 640 ? "day" : "week";
  });
  // The calendar's share of the width on wide screens (%), set by dragging the divider; saved in this browser.
  const mainRef = useRef<HTMLElement>(null);
  const [split, setSplit] = useState(() => {
    try {
      const v = Number(localStorage.split);
      if (v >= SPLIT_MIN && v <= SPLIT_MAX) return v;
    } catch {}
    return SPLIT_DEFAULT;
  });
  const shownSplit = mounted ? split : SPLIT_DEFAULT; // the server can't know the saved one
  function saveSplit(v: number) {
    const next = Math.round(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, v)));
    setSplit(next);
    try {
      localStorage.split = next;
    } catch {}
  }
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
  const [priorities, setPriorities] = useState<Priority[] | null>(null);
  const firstPriorities = useRef(true);
  const [showAssistant, setShowAssistant] = useState(false);
  const [menu, setMenu] = useState(false);
  const [moved, setMoved] = useState<{ key: number; title: string; undo: () => void } | null>(null);
  const [todoDrag, setTodoDrag] = useState<TodoDrag | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuClose = useRef<HTMLButtonElement>(null);
  const menuWasOpen = useRef(false);
  const [todos, setTodos] = useState(false); // the to-do pop-up (from the "+" menu)
  const [nowOpen, setNowOpen] = useState(false); // "What now?"
  const [review, setReview] = useState(false); // the week in review
  const [quick, setQuick] = useState(false); // "New": add by typing or saying one line
  const [away, setAway] = useState<AwayKind | null>(null); // the out of office / focus time pop-up
  const wide = useWide();
  const [sheet, setSheet] = useState<"today" | "priorities" | null>(null); // phones: Today's plan / Priorities
  // Priorities sit beside the calendar on wide screens (scroll to them) and open as a sheet on phones.
  const showPriorities = useCallback(() => {
    if (!matchMedia(WIDE).matches) return setSheet("priorities");
    const el = document.getElementById("priorities");
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    el?.focus({ preventScroll: true });
  }, []);
  // Swipe left / right (finger, or two fingers on a trackpad) for the next / previous day, week or month.
  const swipe = useRef<{ x: number; y: number; t: number } | null>(null);
  const wheel = useRef({ dx: 0, last: 0, until: 0 });
  const [settings, setSettings] = useState(false);
  // The latest saved settings, so the Settings window shows them when it's opened again.
  const [stagesNow, setStagesNow] = useState(stages);
  const [planModeNow, setPlanModeNow] = useState(planMode);
  const [profileNow, setProfileNow] = useState(profile);
  const [about, setAbout] = useState(profile === null);
  // Focus moves into the menu when it opens and back to ☰ when it closes.
  useEffect(() => {
    if (menu) menuClose.current?.focus();
    else if (menuWasOpen.current) menuButton.current?.focus();
    menuWasOpen.current = menu;
  }, [menu]);

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

  // Dragging an event to a new time. Only events you organise, on calendars you can change.
  const canDrag = useCallback((e: Ev) => !e.allDay && e.isOrganizer && !!calendars.find((c) => c.id === e.calendarId)?.canEdit, [calendars]);

  // Simple events save straight away, with Undo. Repeating ones and ones with guests open the editor at the new
  // time instead, so "This event or all?" and "Send invites to these people?" are still asked.
  async function moveEvent(e: Ev, start: Date, end: Date) {
    if (e.recurringEventId || e.attendees?.some((a) => !a.self)) return setPanel({ form: draftMoved(e, start, end), event: e });
    const save = async (s: Date, en: Date) => {
      mutate((evs) => evs.map((x) => (x.id === e.id && x.calendarId === e.calendarId ? { ...x, start: s.toISOString(), end: en.toISOString() } : x)));
      try {
        await send("POST", {
          calendarId: e.calendarId,
          id: e.id,
          title: e.title === "(No title)" ? "" : e.title,
          allDay: false,
          start: s.toISOString(),
          end: en.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          location: e.location ?? "",
          description: e.description ?? "",
          colorId: e.colorId ?? null,
          recurrence: null,
        } satisfies SaveInput);
      } catch (err) {
        setError(`Couldn't move “${e.title}”. ${(err as Error).message}`);
      }
      setGen((g) => g + 1);
    };
    const before = [parseWhen(e.start, false), parseWhen(e.end, false)] as const;
    await save(start, end);
    const key = Date.now();
    const when = `${start.toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit" })} – ${formatTime(end)}`;
    setMoved({ key, title: `“${e.title}” now ${when}`, undo: () => (setMoved(null), save(...before)) });
    setTimeout(() => setMoved((m) => (m?.key === key ? null : m)), UNDO_MS);
  }

  // A to-do dragged from the menu onto the calendar gets that time booked for it.
  function dragTodo(t: { id: string; title: string; minutes: number }, x: number, y: number) {
    setMenu(false);
    setTodos(false);
    setQuery("");
    if (view !== "day" && view !== "week") changeView("week");
    setTodoDrag({ ...t, x, y });
  }
  async function dropTodo(start: Date | null) {
    const t = todoDrag;
    setTodoDrag(null);
    if (!t || !start) return;
    const r = await fetch("/api/todos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: t.id, schedule: true, start: start.toISOString() }),
    });
    if (!r.ok) setError((await r.json().catch(() => null))?.error ?? "Couldn't book time for that to-do.");
    setGen((g) => g + 1);
  }

  // Priorities: reloaded whenever the calendar is, and always shown beside it. A notification can ask to bring
  // them into view (?priorities=1, or a message from the service worker), which matters on phones where they sit below.
  useEffect(() => {
    fetch("/api/priorities")
      .then((r) => (r.ok ? r.json() : null))
      .then((list: Priority[] | null) => {
        if (!list) return;
        setPriorities(list);
        if (!firstPriorities.current) return;
        firstPriorities.current = false;
        if (new URLSearchParams(location.search).has("priorities")) setTimeout(showPriorities, 300);
        history.replaceState(null, "", location.pathname);
      })
      .catch(() => {});
  }, [gen, showPriorities]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data === "show-priorities") showPriorities();
      if (e.data === "show-review") setReview(true);
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    syncPush();
    // Opened from the Sunday notification (?review=1): show the week in review.
    const t = setTimeout(() => new URLSearchParams(location.search).has("review") && setReview(true));
    return () => {
      navigator.serviceWorker?.removeEventListener("message", onMessage);
      clearTimeout(t);
    };
  }, [showPriorities]);

  async function priorityAction(p: Pick<Priority, "calendarId" | "eventId">, a: PriorityAction) {
    const r = await fetch("/api/priorities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ calendarId: p.calendarId, eventId: p.eventId, ...a }),
    });
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error(body?.error === "reauth" ? "Google needs you to sign in again." : (body?.error ?? "Something went wrong."));
    setPriorities(body);
  }

  const priorityOf = useMemo(() => new Map((priorities ?? []).map((p) => [p.key, p])), [priorities]);
  const severityOf = useCallback(
    (e: Ev): Severity | undefined => {
      const p = priorityOf.get(`${e.calendarId}:${e.id}`);
      return p && p.status !== "done" ? p.severity : undefined;
    },
    [priorityOf],
  );

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
      if (panel || showAssistant || menu || settings || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]")) return;
      if (KEYS[e.key]) changeView(KEYS[e.key]);
      else if (e.key === "t") goToday();
      else if (e.key === "n") {
        e.preventDefault(); // keep the "n" out of the box that opens
        setQuick(true);
      }
      else if (e.key === "p") showPriorities();
      else if (e.key === "\\") setMenu(true);
      else if (e.key === "k") {
        e.preventDefault(); // keep the "k" out of the chat box that opens
        setShowAssistant(true);
      }
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
        <div className="flex w-full items-center justify-between gap-4 px-3 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <button
              ref={menuButton}
              type="button"
              onClick={() => setMenu(true)}
              aria-label="Open menu: calendars, to-do, categories"
              aria-expanded={menu}
              aria-controls="menu"
              title="Menu (\)"
              className="grid size-10 place-items-center rounded-full hover:bg-ink/5"
            >
              <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <span className="font-serif text-2xl">Almanac</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-muted sm:inline">{name}</span>
            <button
              type="button"
              onClick={() => setSettings(true)}
              aria-label="Settings"
              title="Settings"
              className="grid size-10 place-items-center rounded-full border border-line bg-surface hover:border-ink/40"
            >
              <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
              </svg>
            </button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="w-full flex-1 px-3 py-4 sm:px-6">
        {/* The side panel slides out over the calendar. It stays mounted while closed (inert), so the to-do list
            and sheet panel keep their state and don't reload every time it opens. */}
        <AnimatePresence>
          {menu && (
            <motion.div
              key="scrim"
              className="fixed inset-0 z-40 bg-ink/25"
              onClick={() => setMenu(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              aria-hidden
            />
          )}
        </AnimatePresence>
        <motion.aside
          id="menu"
          aria-label="Calendars"
          inert={!menu}
          initial={false}
          animate={{ x: menu ? 0 : "-105%" }}
          transition={{ type: "spring", damping: 32, stiffness: 340 }}
          onKeyDown={(e) => e.key === "Escape" && setMenu(false)}
          className="fixed inset-y-0 left-0 z-50 w-[min(22rem,88vw)] overflow-y-auto border-r border-line bg-paper px-5 pb-8 pt-3 shadow-2xl"
        >
          <div className="mb-4 flex items-center justify-between">
            <span className="font-serif text-2xl">Almanac</span>
            <button
              ref={menuClose}
              type="button"
              onClick={() => setMenu(false)}
              aria-label="Close menu"
              className="grid size-10 place-items-center rounded-full text-muted hover:bg-ink/5 hover:text-ink"
            >
              ✕
            </button>
          </div>
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Calendars</h2>
          <ul className="mt-3 flex flex-col gap-0.5">
            {calendars.map((c, i) => {
              const on = !hidden.has(c.id);
              return (
                <motion.li key={c.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04, ease }}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(c.id)}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-sm hover:bg-ink/5"
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

          <h2 className="mt-6 font-mono text-xs uppercase tracking-[0.2em] text-muted">To-do</h2>
          <TodoList
            version={gen}
            now={now}
            onCalendarChange={() => setGen((g) => g + 1)}
            onOpenDay={(d) => {
              openDay(startOfDay(d));
              setMenu(false);
            }}
            onDragStart={dragTodo}
          />

          <button
            type="button"
            onClick={() => {
              setMenu(false);
              setReview(true);
            }}
            className="mt-3 rounded-full border border-line px-3 py-1.5 text-sm hover:border-ink/40"
          >
            Your week in review
          </button>

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
        </motion.aside>

        <AlertsBanner />
        {/* Wide screens: calendar and side column fill the screen's height (6.25rem = header + padding), split
            where you drag the divider (70/30 to start). Narrower: the side column follows below. */}
        <main
          ref={mainRef}
          className="grid min-w-0 items-start gap-4 lg:h-[calc(100dvh-6.25rem)] lg:grid-cols-[minmax(0,var(--l))_auto_minmax(0,var(--r))] lg:items-stretch lg:gap-0"
          style={{ "--l": `${shownSplit}fr`, "--r": `${100 - shownSplit}fr` } as React.CSSProperties}
        >
          <div className="flex min-w-0 flex-col lg:min-h-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1 *:whitespace-nowrap">
              {/* New, To-do and the rest live in the round "+" above Ask Almanac. */}
              <button type="button" onClick={goToday} className="rounded-full border border-line px-4 py-1.5 text-sm hover:border-ink/40">
                Today
              </button>
              <button type="button" onClick={() => setNowOpen(true)} className="rounded-full border border-accent/60 px-3 py-1.5 text-sm text-accent hover:border-accent">
                What now?
              </button>
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
                placeholder="Search"
                className="w-24 rounded-full border border-line bg-surface px-3 py-1.5 text-sm placeholder:text-muted focus:w-40 focus:outline-none focus:ring-2 focus:ring-accent/50 sm:w-44 sm:px-4 sm:focus:w-56 motion-safe:transition-[width]"
              />
            </label>
            {mounted && !wide && (
              <div className="flex w-full gap-2">
                <button type="button" onClick={() => setSheet("today")} className="flex-1 rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:border-ink/40">
                  Today&rsquo;s plan
                </button>
                <button type="button" onClick={() => setSheet("priorities")} className="flex-1 rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:border-ink/40">
                  Priorities{priorities?.length ? ` · ${priorities.filter((p) => p.status !== "done").length}` : ""}
                </button>
              </div>
            )}
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

          <div className="relative mt-4 lg:min-h-0 lg:flex-1">
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
              <section aria-live="polite" className="lg:h-full lg:overflow-y-auto">
                <p className="mb-4 text-sm text-muted">
                  {found ? `${found.length} result${found.length === 1 ? "" : "s"} for “${q}” in the past and next year` : `Searching for “${q}”…`}
                </p>
                {found && <Agenda days={foundDays} events={found} color={color} severityOf={severityOf} now={now} onOpen={openEvent} showFree={false} />}
              </section>
            ) : (
              <div
                className="overflow-hidden overscroll-x-contain lg:h-full"
                onTouchStart={(e) => {
                  const t = e.touches[0];
                  swipe.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY, t: Date.now() } : null;
                }}
                onTouchEnd={(e) => {
                  const s = swipe.current;
                  swipe.current = null;
                  const t = e.changedTouches[0];
                  if (!s || !t) return;
                  const dx = t.clientX - s.x;
                  // A quick, mostly sideways stroke; a long press (moving an event) or a scroll doesn't count.
                  if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(t.clientY - s.y) && Date.now() - s.t < 700) go(dx < 0 ? 1 : -1);
                }}
                onWheel={(e) => {
                  if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
                  const w = wheel.current;
                  const t = Date.now();
                  // After a change, wait for the trackpad's glide to stop before the next one.
                  if (t < w.until) return void (w.until = t + 300);
                  if (t - w.last > 250) w.dx = 0;
                  w.last = t;
                  w.dx += e.deltaX;
                  if (Math.abs(w.dx) < 120) return;
                  go(w.dx > 0 ? 1 : -1);
                  w.dx = 0;
                  w.until = t + 300;
                }}
              >
                <AnimatePresence mode="popLayout" custom={dir} initial={false}>
                  <motion.div
                    key={`${view}:${key}`}
                    custom={dir}
                    variants={slide}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.35, ease }}
                    className="lg:h-full lg:overflow-y-auto"
                  >
                    {view === "month" ? (
                      <MonthGrid days={days} month={anchor.getMonth()} events={visible} color={color} severityOf={severityOf} now={now} onPickDay={openDay} />
                    ) : view === "agenda" ? (
                      <Agenda days={days} events={visible} color={color} severityOf={severityOf} now={now} onOpen={openEvent} />
                    ) : (
                      <TimeGrid
                        days={days}
                        events={visible}
                        color={color}
                        severityOf={severityOf}
                        now={now}
                        onPickDay={openDay}
                        onOpen={openEvent}
                        onBook={writable ? book : undefined}
                        canDrag={canDrag}
                        onMove={moveEvent}
                        todoDrag={todoDrag}
                        onTodoDrop={dropTodo}
                      />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            )}
          </div>
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Drag to resize the calendar and the side column. Double-click to reset."
            aria-valuemin={SPLIT_MIN}
            aria-valuemax={SPLIT_MAX}
            aria-valuenow={shownSplit}
            tabIndex={0}
            title="Drag to resize · double-click to reset"
            onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
            onPointerMove={(e) => {
              const rect = mainRef.current?.getBoundingClientRect();
              if (rect && e.currentTarget.hasPointerCapture(e.pointerId)) saveSplit(((e.clientX - rect.left) / rect.width) * 100);
            }}
            onDoubleClick={() => saveSplit(SPLIT_DEFAULT)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                saveSplit(split + (e.key === "ArrowLeft" ? -2 : 2));
              }
            }}
            className="group hidden w-4 cursor-col-resize touch-none justify-center rounded-full focus-visible:outline-2 focus-visible:outline-accent lg:flex"
          >
            <span className="relative w-px bg-line transition-colors group-hover:bg-accent group-active:bg-accent">
              <span className="absolute top-1/2 left-1/2 h-10 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-line transition-colors group-hover:bg-accent group-active:bg-accent" />
            </span>
          </div>
          {wide && (
            <div className="min-w-0 space-y-4 lg:flex lg:min-h-0 lg:flex-col lg:gap-4 lg:space-y-0 lg:overflow-y-auto">
              <TodayCard version={gen} onCalendarChange={() => setGen((g) => g + 1)} />
              <Suggestions version={gen} onCalendarChange={() => setGen((g) => g + 1)} />
              <PrioritiesPanel items={priorities} onAction={priorityAction} />
            </div>
          )}
        </main>
      </div>

      <AnimatePresence>
        {panel && (
          <EventPanel
            key="panel"
            initial={panel.form}
            event={panel.event}
            calendars={calendars}
            priority={panel.event && priorityOf.get(`${panel.event.calendarId}:${panel.event.id}`)}
            onDeadline={(deadline) => priorityAction({ calendarId: panel.event!.calendarId, eventId: panel.event!.id }, { action: "deadline", deadline })}
            onClose={() => setPanel(null)}
            onSave={saveEvent}
            onDelete={(scope, send) => scheduleDelete(panel.event!, scope, send)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {todos && (
          <TodoDialog
            key="todos"
            version={gen}
            now={now}
            onCalendarChange={() => setGen((g) => g + 1)}
            onOpenDay={(d) => {
              openDay(startOfDay(d));
              setTodos(false);
            }}
            onDragStart={dragTodo}
            onClose={() => setTodos(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {nowOpen && <WhatNow key="now" onClose={() => setNowOpen(false)} onCalendarChange={() => setGen((g) => g + 1)} />}
        {review && <Review key="review" onClose={() => setReview(false)} />}
        {settings && (
          <Settings
            key="settings"
            onClose={() => setSettings(false)}
            stages={stagesNow}
            onStages={setStagesNow}
            planMode={planModeNow}
            onPlanMode={(m) => {
              setPlanModeNow(m);
              setGen((g) => g + 1);
            }}
            now={now}
            onCalendarChange={() => setGen((g) => g + 1)}
            profile={profileNow}
            onEditProfile={() => {
              setSettings(false);
              setAbout(true);
            }}
          />
        )}
        {about && (
          <Welcome
            key="about"
            initial={profileNow ?? EMPTY_PROFILE}
            first={profileNow === null}
            onDone={(p) => {
              setAbout(false);
              if (JSON.stringify(p) === JSON.stringify(profileNow)) return;
              setProfileNow(p);
              setGen((g) => g + 1); // priorities are re-rated with the new answers
            }}
          />
        )}
        {quick && writable && (
          <QuickAdd
            key="quick"
            onClose={() => setQuick(false)}
            onForm={() => {
              setQuick(false);
              newEvent();
            }}
            onTodoAdded={() => setGen((g) => g + 1)}
            onEvent={(p) => {
              setQuick(false);
              // The event form is the confirmation: nothing is saved until Save is pressed there.
              const start = p.kind === "event" ? new Date(p.start) : new Date(`${p.date}T09:00`);
              const end = p.kind === "event" ? new Date(p.end) : new Date(+start + 3_600_000);
              const form = { ...draftFromSlot(start, end, writable.id), title: p.title, location: p.location };
              setPanel({ form: p.kind === "allday" ? { ...form, allDay: true, date: p.date, endDate: p.date } : form });
            }}
          />
        )}
        {away && <AwayDialog key="away" kind={away} now={now} onClose={() => setAway(null)} onSaved={() => setGen((g) => g + 1)} />}
        {sheet && !wide && (
          <Modal key="sheet" title={sheet === "today" ? "Today" : "Your priorities"} onClose={() => setSheet(null)}>
            {sheet === "today" ? (
              <div className="space-y-4">
                <TodayCard version={gen} onCalendarChange={() => setGen((g) => g + 1)} />
                <Suggestions version={gen} onCalendarChange={() => setGen((g) => g + 1)} />
              </div>
            ) : (
              <PrioritiesPanel items={priorities} onAction={priorityAction} />
            )}
          </Modal>
        )}
      </AnimatePresence>

      <FullScreenAlert onChanged={() => setGen((g) => g + 1)} />

      {!showAssistant && (
        <CreateMenu
          canEdit={!!writable}
          onNew={() => setQuick(true)}
          onTodo={() => setTodos(true)}
          onMeeting={() => {
            if (!writable) return;
            // Next half hour, 30 minutes, with a Meet link; guests are added in the form, which asks before inviting anyone.
            const start = new Date(Math.ceil(Date.now() / 1_800_000) * 1_800_000);
            setPanel({ form: { ...draftFromSlot(start, new Date(+start + 30 * 60_000), writable.id), addMeet: true } });
          }}
          onAway={setAway}
        />
      )}
      <Assistant open={showAssistant} onOpenChange={setShowAssistant} onChanged={() => setGen((g) => g + 1)} />

      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex flex-col items-center gap-2 px-4">
        <AnimatePresence>
          {moved && (
            <motion.div
              key={`moved-${moved.key}`}
              layout
              initial={{ y: 40, opacity: 0, scale: 0.95 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 20, opacity: 0, scale: 0.95 }}
              transition={{ type: "spring", damping: 26, stiffness: 380 }}
              className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-sm text-paper shadow-xl"
            >
              <span className="min-w-0 flex-1 truncate">{moved.title}</span>
              <button type="button" onClick={moved.undo} className="rounded-full bg-paper/15 px-3 py-1 font-medium hover:bg-paper/25">
                Undo
              </button>
            </motion.div>
          )}
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
