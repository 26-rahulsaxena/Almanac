"use client";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { doneEventKeys, setCalendarColor, setHiddenCalendars, setRemovedCalendars, type AlertStages } from "@/app/actions";
import { appHasWidget, saveAgenda } from "@/lib/android-app";
import { GoogleSignIn } from "./google-sign-in";
import type { Cal, Ev } from "@/lib/calendar";
import { CATEGORIES, categoryHex } from "@/lib/categories";
import type { DeleteInput, SaveInput, Scope, SendUpdates } from "@/lib/recurrence";
import { addDays, atHour, endedToday, formatTime, parseWhen, startOfDay, startOfMonth, startOfWeek, greeting } from "@/lib/time";
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
import { AddCalendarHelp } from "./add-calendar";
import { MailFinds } from "./mail-finds";
import { Modal, Review, TodayCard, WhatNowBody } from "./coach";
import { BottomBar, DateButton, MonthPanel, TAB_TITLE, WeekStrip, type Tab } from "./phone";
import { Suggestions, type PlanMode } from "./suggestions";
import { ThemeToggle } from "./theme-toggle";
import { TodoBody, TodoDialog } from "./todo-dialog";
import { Agenda } from "./views/agenda";
import { MonthGrid } from "./views/month-grid";
import { TimeGrid, type TodoDrag } from "./views/time-grid";

const ease = [0.22, 1, 0.36, 1] as const;
type View = "day" | "week" | "month" | "agenda";
const VIEWS: View[] = ["agenda", "day", "week", "month"];
const LENGTH: Record<View, number> = { day: 1, week: 7, month: 42, agenda: 14 };
const KEYS: Record<string, View> = { d: "day", w: "week", m: "month", a: "agenda" };
const TODO_CAL = "almanac:todos"; // marks to-dos shown among the events (never a real Google calendar id)

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

const NO_MAIL = "Nothing waiting from your email. With Read my email on (Settings), meetings, calls and deadlines found in new mail show up here.";

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
  email,
  calendars: googleCalendars,
  hidden: initialHidden,
  colors: initialColors,
  removed: initialRemoved,
  stages,
  planMode,
  mail,
  profile,
}: {
  name: string;
  email: string;
  calendars: Cal[];
  hidden: string[];
  colors: Record<string, string>;
  removed: string[];
  stages: AlertStages;
  planMode: PlanMode;
  mail: { gmail: boolean; on: boolean }; // "Read my email": Gmail allowed, switched on
  profile: Profile | null; // null: not asked yet, so the welcome pop-up shows
}) {
  const mounted = useMounted();
  const now = useNow();
  const [hidden, setHidden] = useState(() => new Set(initialHidden));
  // Your own calendar colours and the calendars taken off the menu list (Almanac only; Google keeps its own).
  const [colors, setColors] = useState(initialColors);
  const [removed, setRemoved] = useState(() => new Set(initialRemoved));
  const [editCal, setEditCal] = useState<string | null>(null); // the calendar whose ⋯ panel is open
  const [showRemoved, setShowRemoved] = useState(false);
  const calendars = useMemo(() => googleCalendars.map((c) => (colors[c.id] ? { ...c, color: colors[c.id] } : c)), [googleCalendars, colors]);
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
  const [searchOpen, setSearchOpen] = useState(false); // the search box under the top bar, opened from its icon
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
  const [doneKeys, setDoneKeys] = useState<Set<string>>(() => new Set()); // "calendarId:eventId" of what's ticked Done
  const firstPriorities = useRef(true);
  const [showAssistant, setShowAssistant] = useState(false);
  const [menu, setMenu] = useState(false);
  const [moved, setMoved] = useState<{ key: number; title: string; undo: () => void } | null>(null);
  const [todoDrag, setTodoDrag] = useState<TodoDrag | null>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menuClose = useRef<HTMLButtonElement>(null);
  const menuWasOpen = useRef(false);
  const [todos, setTodos] = useState<boolean | DOMRect>(false); // the to-do pop-up (a DOMRect: opened from that header button, so it hangs under it)
  const [review, setReview] = useState(false); // the week in review
  const [addCal, setAddCal] = useState(false); // how to add a calendar from another Google account
  const [away, setAway] = useState<AwayKind | null>(null); // the out of office / focus time pop-up
  const wide = useWide();
  // Email finds waiting: behind the header's mail button on wide screens, the Email tab on phones (both with a count).
  const [mailCount, setMailCount] = useState<number | null>(null); // null: not known yet
  const [mailOpen, setMailOpen] = useState<DOMRect | null>(null); // where its header button is, while open
  const [nowPick, setNowPick] = useState<string | null>(null); // the task What now? is suggesting, left out of today's plan under it
  const [todayAt, setTodayAt] = useState<DOMRect | null>(null); // the Today button, while its plan bubble is open
  const [monthAt, setMonthAt] = useState<DOMRect | null>(null); // the date title, while its month bubble is open
  useEffect(() => {
    fetch("/api/mail")
      .then((r) => (r.ok ? r.json() : null))
      .then((l) => setMailCount(Array.isArray(l) ? l.length : 0))
      .catch(() => {});
  }, [gen, setMailCount]);
  // Phones: the page picked in the bottom bar, and the month dropped down from the date at the top.
  const [tab, setTab] = useState<Tab>("calendar");
  const [monthOpen, setMonthOpen] = useState(false);
  const phone = mounted && !wide;
  // A red dot on Today (the header icon, the phone's tab) while it has a suggestion you haven't opened it to see:
  // What now?'s pick and the day plan's tasks. Opening Today clears it until a new one comes. Remembered per device.
  // shortcut: rechecked when the calendar changes and every 10 min; push it from the server if it should be instant.
  const [todayTips, setTodayTips] = useState<string[] | null>(null);
  const [todaySeen, setTodaySeen] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.todaySeen ?? "[]");
    } catch {
      return [];
    }
  });
  useEffect(() => {
    const check = () =>
      fetch("/api/coach")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { now?: { picks?: { title: string }[] }; today?: { blocks?: { title: string }[] } } | null) => {
          if (d) setTodayTips([d.now?.picks?.[0]?.title, ...(d.today?.blocks ?? []).map((b) => b.title)].filter((t): t is string => !!t));
        })
        .catch(() => {});
    check();
    const id = setInterval(check, 10 * 60_000);
    return () => clearInterval(id);
  }, [gen]);
  const seeToday = () => {
    if (!todayTips) return;
    setTodaySeen(todayTips);
    try {
      localStorage.todaySeen = JSON.stringify(todayTips);
    } catch {}
  };
  const todayDot = !!todayTips?.some((t) => !todaySeen.includes(t)) && !todayAt && !(phone && tab === "today");
  const openTodos = () => (matchMedia(WIDE).matches ? setTodos(true) : setTab("todo"));
  // Priorities sit beside the calendar on wide screens (scroll to them) and are a page of their own on phones.
  const showPriorities = useCallback(() => {
    if (!matchMedia(WIDE).matches) return setTab("priorities");
    const el = document.getElementById("priorities");
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    el?.focus({ preventScroll: true });
  }, []);
  // Swipe left / right (finger, or two fingers on a trackpad) for the next / previous day, week or month.
  const swipe = useRef<{ x: number; y: number; t: number } | null>(null);
  const wheel = useRef({ dx: 0, last: 0, until: 0 });
  const [settings, setSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"App" | "Planning">(); // from the "new version" notification, or back from allowing Gmail
  // The latest saved settings, so the Settings window shows them when it's opened again.
  const [stagesNow, setStagesNow] = useState(stages);
  const [planModeNow, setPlanModeNow] = useState(planMode);
  const [mailNow, setMailNow] = useState(mail);
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
  // The shown calendars' events in a range, for the dots under the days in the week strip and the month.
  const loadShown = (f: Date, t: Date) => fetchEvents({ from: f.toISOString(), to: t.toISOString() }, calIds.filter((id) => !hidden.has(id)));
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

  // What's ticked Done, reloaded with the calendar and after any answer in Priorities. The Agenda and the phone
  // widget list what's still ahead, so they leave these out (and, today, what's already over).
  useEffect(() => {
    doneEventKeys().then((keys) => setDoneKeys(new Set(keys)), () => {});
  }, [gen, priorities]);
  const agendaDone = useCallback((e: Ev) => doneKeys.has(`${e.calendarId}:${e.id}`) || endedToday(e, now), [doneKeys, now]);

  // The Android home-screen Agenda widget: the next two weeks of shown calendars, saved on the phone each time the
  // calendar reloads (opening the app, coming back to it, any change).
  useEffect(() => {
    if (!mounted || !appHasWidget()) return;
    const shown = calIds.filter((id) => !hidden.has(id));
    if (shown.length === 0) return void saveAgenda([]).catch(() => {});
    const now = new Date();
    fetchEvents({ from: now.toISOString(), to: addDays(startOfDay(now), 14).toISOString() }, shown)
      .then((events) =>
        saveAgenda(
          events
            .filter((e) => !doneKeys.has(`${e.calendarId}:${e.id}`))
            .map((e) => ({ title: e.title, start: +parseWhen(e.start, e.allDay), end: +parseWhen(e.end, e.allDay), allDay: e.allDay, color: color(e) }))
            .sort((a, b) => a.start - b.start)
            .slice(0, 80),
        ),
      )
      .catch(() => {}); // the widget keeps what it had
  }, [mounted, gen, calIds, hidden, color, doneKeys]);

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
    setTab("calendar");
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

  // Open to-dos that have no time booked yet: at their due time (a 30-minute item), all day on their due day when
  // it has no real time ("by Friday" is saved as 23:59), or all day today when there's no due date or it's an
  // earlier day. Booked ones are already on the calendar as their own block.
  const [todoList, setTodoList] = useState<{ id: string; title: string; due_at: string | null; done: boolean; event_id: string | null }[]>([]);
  useEffect(() => {
    fetch("/api/todos")
      .then((r) => (r.ok ? r.json() : null))
      .then((list) => list && setTodoList(list))
      .catch(() => {});
  }, [gen]);
  const todayKey = +startOfDay(now); // changes once a day, not every minute
  const todoEvents = useMemo(() => {
    const today = new Date(todayKey);
    const ymd = (d: Date) => d.toLocaleDateString("en-CA"); // YYYY-MM-DD, local
    return todoList
      .filter((t) => !t.done && !t.event_id)
      .map((t): Ev => {
        const item = { id: t.id, calendarId: TODO_CAL, title: `☐ ${t.title}`, busy: false, isOrganizer: false };
        const at = t.due_at ? new Date(t.due_at) : null;
        const hm = at && at.getHours() * 60 + at.getMinutes();
        if (at && at >= today && hm !== 0 && hm !== 23 * 60 + 59) {
          return { ...item, start: at.toISOString(), end: new Date(+at + 30 * 60_000).toISOString(), allDay: false };
        }
        const day = at && at >= today ? startOfDay(at) : today;
        return { ...item, start: ymd(day), end: ymd(addDays(day, 1)), allDay: true };
      });
  }, [todoList, todayKey]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data === "show-priorities") showPriorities();
      if (e.data === "show-review") setReview(true);
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    syncPush();
    // Opened from the Sunday notification (?review=1): show the week in review. From "New version of Almanac"
    // (?update=1): Settings → App, where it downloads.
    const t = setTimeout(() => {
      const q = new URLSearchParams(location.search);
      if (q.has("review")) setReview(true);
      if (q.has("update") || q.has("mail")) {
        setSettingsTab(q.has("mail") ? "Planning" : "App");
        setSettings(true);
      }
    });
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
        e.preventDefault(); // keep the "n" out of the title box that opens
        newEvent();
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
        setSearchOpen(true);
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

  function recolor(id: string, color: string | null) {
    setColors((all) => {
      const next = { ...all };
      if (color) next[id] = color;
      else delete next[id];
      return next;
    });
    setCalendarColor(id, color).catch(() => setError("Couldn't save the colour."));
  }

  // Removing also hides it (so its events and reminders stop); putting it back shows it again.
  function setOnList(id: string, on: boolean) {
    const r = new Set(removed);
    const h = new Set(hidden);
    if (on) {
      r.delete(id);
      h.delete(id);
    } else {
      r.add(id);
      h.add(id);
    }
    setRemoved(r);
    setHidden(h);
    setEditCal(null);
    Promise.all([setRemovedCalendars([...r]), setHiddenCalendars([...h])]).catch(() => setError("Couldn't save your calendar list."));
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
      [...(entry?.events ?? []), ...todoEvents]
        .filter(shown)
        .sort((a, b) => +parseWhen(a.start, a.allDay) - +parseWhen(b.start, b.allDay) || Number(b.allDay) - Number(a.allDay)),
    [entry, todoEvents, shown],
  );
  const found = results?.q === q ? results.events.filter(shown) : null;
  const openEvent = (e: Ev) => (e.calendarId === TODO_CAL ? openTodos() : setPanel({ form: draftFromEvent(e), event: e }));
  const openPriorities = priorities?.filter((p) => p.status !== "done").length ?? 0;
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
        <div className="flex w-full items-center justify-between gap-2 px-3 py-3 sm:gap-4 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-1 lg:flex-none lg:gap-2">
            <button
              ref={menuButton}
              type="button"
              onClick={() => setMenu(true)}
              aria-label="Open menu: view, calendars, categories"
              aria-expanded={menu}
              aria-controls="menu"
              title="Menu (\)"
              className="grid size-10 place-items-center rounded-full hover:bg-ink/5"
            >
              <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <span className={`font-serif text-2xl transition-opacity max-lg:hidden ${searchOpen ? "opacity-0" : ""}`}>Almanac</span>
            {/* Phones: the day being shown (tap for the month), or the name of the page picked in the bottom bar. */}
            {phone &&
              (tab === "calendar" ? (
                <DateButton day={anchor} now={now} open={monthOpen} onToggle={() => setMonthOpen(!monthOpen)} />
              ) : (
                <div className="min-w-0 flex-1 py-1">
                  <span className="block text-xs text-muted">{now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })}</span>
                  <h1 className="mt-0.5 truncate font-serif text-[1.85rem] leading-none">{TAB_TITLE[tab]}</h1>
                </div>
              ))}
          </div>
          <div className="flex shrink-0 items-center gap-1 lg:gap-2">
            {/* Search: the round button grows to the left into the search box (over the name and date while open). */}
            <div className="relative size-9 shrink-0 sm:size-10">
              <div
                className={`absolute right-0 top-0 z-10 flex h-9 items-center sm:h-10 overflow-hidden rounded-full border bg-surface transition-[width,border-color] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  searchOpen ? "w-[min(22rem,calc(100vw-10.5rem))] border-accent/60" : "w-9 border-line hover:border-ink/40 sm:w-10"
                }`}
              >
                <button
                  type="button"
                  onClick={() => (searchOpen ? searchRef.current?.focus() : setSearchOpen(true))}
                  aria-label="Search events"
                  aria-expanded={searchOpen}
                  title="Search (/)"
                  className="grid size-9 shrink-0 place-items-center sm:size-10"
                >
                  <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                </button>
                {searchOpen && (
                  <>
                    <input
                      ref={searchRef}
                      autoFocus
                      type="search"
                      aria-label="Search events"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Escape" && (setQuery(""), setSearchOpen(false))}
                      placeholder="Search events"
                      style={{ outline: "none" }} // the pill's orange border already shows it's active
                      className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        setSearchOpen(false);
                      }}
                      aria-label="Close search"
                      className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:text-ink"
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            </div>
            {/* Wide screens: search, Today, mail, To-do, theme, settings. Phones have Today and To-do in the bottom bar. */}
            <button
              type="button"
              onClick={(e) => {
                seeToday();
                setTodayAt(e.currentTarget.getBoundingClientRect());
              }}
              aria-label={`Today: what to do now, and the rest of the day${todayDot ? " (new suggestion)" : ""}`}
              title="Today"
              className="relative hidden size-10 shrink-0 place-items-center rounded-full border border-line bg-surface hover:border-ink/40 lg:grid"
            >
              {/* The phone bar's Today icon: a rounded square with a dot. */}
              <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="4" y="4" width="16" height="16" rx="5" />
                <circle cx="17" cy="7" r="2.2" fill="currentColor" stroke="none" />
              </svg>
              {/* A plain red dot, no number: Today has a suggestion you haven't opened it to see. */}
              {todayDot && <span className="absolute -top-0.5 -right-0.5 size-3 rounded-full bg-accent ring-2 ring-paper" aria-hidden />}
            </button>
            {/* Always there on wide screens; the count shows only when something is waiting. */}
            {wide && (
              <button
                type="button"
                onClick={(e) => setMailOpen(e.currentTarget.getBoundingClientRect())}
                aria-label={mailCount ? `Found in your email: ${mailCount} waiting` : "Found in your email"}
                title="Found in your email"
                className={`relative grid size-10 shrink-0 place-items-center rounded-full border bg-surface hover:border-ink/40 ${mailCount ? "border-accent/50" : "border-line"}`}
              >
                <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="m3.5 6.5 8.5 6 8.5-6" />
                </svg>
                {!!mailCount && (
                  <span className="absolute -top-1 -right-1 grid min-w-5 place-items-center rounded-full bg-accent px-1 text-[0.7rem] font-medium leading-5 text-paper" aria-hidden>
                    {mailCount}
                  </span>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={(e) => setTodos(e.currentTarget.getBoundingClientRect())}
              aria-label="To-dos"
              title="To-dos"
              className="hidden size-10 shrink-0 place-items-center rounded-full border border-line bg-surface hover:border-ink/40 lg:grid"
            >
              {/* A checklist: two ticks and two lines. */}
              <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m3.5 7 1.8 1.8L8.5 5.5M3.5 15.5l1.8 1.8 3.2-3.3M12 7h8.5M12 16h8.5" />
              </svg>
            </button>
            <ThemeToggle className="size-9 sm:size-10" />
            <button
              type="button"
              onClick={() => setSettings(true)}
              aria-label="Settings"
              title="Settings"
              className="grid size-9 place-items-center rounded-full border border-line bg-surface hover:border-ink/40 sm:size-10"
            >
              {/* The gear turns as the settings panel opens, and back as it closes. */}
              <motion.svg animate={{ rotate: settings ? 180 : 0 }} transition={{ type: "spring", damping: 14, stiffness: 120 }} className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
              </motion.svg>
            </button>
          </div>
        </div>
      </header>

      {/* The calendar runs to the bottom of the screen (on wide screens Priorities too) and scrolls on underneath;
          phones' other pages get room at the bottom so nothing ends up under the bar and the + / Ask Almanac buttons. */}
      <div className={`w-full flex-1 px-3 py-4 sm:px-6 lg:pb-0 ${tab === "calendar" ? "max-lg:pb-0" : "max-lg:pb-48"}`}>
        {/* The side panel slides out over the calendar. It stays mounted while closed (inert), so its panels
            keep their state and don't reload every time it opens. */}
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
          {/* Agenda, day, week or month (also the A, D, W and M keys). */}
          <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">View</h2>
          <div className="relative mt-3 grid grid-cols-4 rounded-full border border-line bg-surface p-0.5" role="group" aria-label="View">
            {VIEWS.map((v) => {
              const on = mounted && view === v; // the saved view is only known in the browser
              return (
                <button
                  key={v}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    changeView(v);
                    setMenu(false);
                  }}
                  title={`${v} (${v[0].toUpperCase()})`}
                  className="relative rounded-full px-3 py-1 text-sm capitalize"
                >
                  {on && <span className="absolute inset-0 rounded-full bg-ink" />}
                  <span className={`relative ${on ? "text-paper" : ""}`}>{v}</span>
                </button>
              );
            })}
          </div>

          <h2 className="mt-6 font-mono text-xs uppercase tracking-[0.2em] text-muted">Calendars</h2>
          <ul className="mt-3 flex flex-col gap-0.5">
            {calendars.filter((c) => !removed.has(c.id)).map((c, i) => {
              const on = !hidden.has(c.id);
              const editing = editCal === c.id;
              return (
                <motion.li key={c.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04, ease }}>
                  <div className="flex items-center">
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(c.id)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-sm hover:bg-ink/5"
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
                  <button
                    type="button"
                    aria-expanded={editing}
                    aria-label={`Colour and options for ${c.name}`}
                    onClick={() => setEditCal(editing ? null : c.id)}
                    className="grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-ink/5 hover:text-ink"
                  >
                    ⋯
                  </button>
                  </div>
                  {editing && (
                    <div className="mx-3 mb-2 mt-1 rounded-xl border border-line bg-surface p-3">
                      <div role="group" aria-label={`Colour for ${c.name}`} className="flex flex-wrap gap-2">
                        {CATEGORIES.map((k) => (
                          <button
                            key={k.id}
                            type="button"
                            aria-label={k.name}
                            aria-pressed={c.color.toLowerCase() === k.hex}
                            onClick={() => recolor(c.id, k.hex)}
                            className={`size-6 rounded-full ${c.color.toLowerCase() === k.hex ? "ring-2 ring-ink ring-offset-2 ring-offset-surface" : ""}`}
                            style={{ background: k.hex }}
                          />
                        ))}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-sm">
                        {colors[c.id] && (
                          <button type="button" onClick={() => recolor(c.id, null)} className="rounded-full border border-line px-3 py-1.5 hover:border-ink/40">
                            Google&rsquo;s colour
                          </button>
                        )}
                        {!c.primary && (
                          <button type="button" onClick={() => setOnList(c.id, false)} className="rounded-full border border-line px-3 py-1.5 hover:border-ink/40">
                            Remove from this list
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </motion.li>
              );
            })}
          </ul>
          {calendars.some((c) => removed.has(c.id)) && (
            <div className="mt-1 px-3">
              <button type="button" aria-expanded={showRemoved} onClick={() => setShowRemoved(!showRemoved)} className="py-1.5 text-sm text-muted hover:text-ink">
                Removed ({calendars.filter((c) => removed.has(c.id)).length}) · {showRemoved ? "Hide" : "Show"}
              </button>
              {showRemoved && (
                <ul className="mb-1 flex flex-col gap-0.5">
                  {calendars.filter((c) => removed.has(c.id)).map((c) => (
                    <li key={c.id} className="flex items-center gap-2.5 py-1 text-sm">
                      <span className="size-3 shrink-0 rounded-full opacity-50" style={{ background: c.color }} aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-muted">{c.name}</span>
                      <button type="button" onClick={() => setOnList(c.id, true)} className="shrink-0 rounded-full border border-line px-2.5 py-0.5 text-xs hover:border-ink/40">
                        Put back
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              setMenu(false);
              setAddCal(true);
            }}
            className="mt-1 px-3 py-1.5 text-left text-sm text-muted hover:text-ink"
          >
            + Add from another Google account
          </button>

          <button
            type="button"
            onClick={() => {
              setMenu(false);
              setReview(true);
            }}
            className="mt-6 rounded-full border border-line px-3 py-1.5 text-sm hover:border-ink/40"
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
          className="grid min-w-0 items-start gap-4 lg:h-[calc(100dvh-5rem)] lg:grid-cols-[minmax(0,var(--l))_auto_minmax(0,var(--r))] lg:items-stretch lg:gap-0"
          style={{ "--l": `${shownSplit}fr`, "--r": `${100 - shownSplit}fr` } as React.CSSProperties}
        >
          <div className="flex min-w-0 flex-col lg:min-h-0">
          {/* Wide screens: the dates shown and What now? (phones have the date at the top and What now? in the bar). */}
          {/* Wide screens: a greeting on the left, the dates shown (tap for the month) on the right. */}
          <div className="flex flex-wrap items-center gap-2 max-lg:hidden">
            <h1 className="mr-auto font-serif text-4xl">
              {/* By the browser's clock; "Hello" until it's known, so the server and browser render the same. */}
              {mounted ? greeting(now.getHours(), name.split(" ")[0]) : `Hello, ${name.split(" ")[0]}`}
            </h1>
            <div className="font-serif text-2xl" aria-live="polite">
              {mounted ? (
                // Opens the month (as on the phone), with a Today button to jump back.
                <button type="button" onClick={(e) => {
                    // The bubble's tail points at the arrow, hanging just under the title.
                    const b = e.currentTarget.getBoundingClientRect();
                    const a = e.currentTarget.querySelector("svg")!.getBoundingClientRect();
                    setMonthAt(new DOMRect(a.left, b.top, a.width, b.height));
                  }} aria-expanded={!!monthAt} title="Pick a day" className="inline-flex items-center gap-2 rounded-xl text-left hover:text-accent">
                  {titleOf(view, anchor, days)}
                  <svg className={`size-5 shrink-0 text-muted transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${monthAt ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              ) : (
                " "
              )}
            </div>
          </div>
          {/* Phones: the month when the date at the top is tapped (it pushes the calendar down), otherwise on the
              day view the week as a strip of days. */}
          {phone && tab === "calendar" && !searching && (
            // The strip folds away while the month unfolds (and back), at the same pace, so the calendar below glides.
            <AnimatePresence initial={false}>
              {monthOpen ? (
                <MonthPanel
                  key="month"
                  day={anchor}
                  now={now}
                  onPick={(d) => {
                    setDir(0);
                    setAnchor(d);
                    setMonthOpen(false);
                  }}
                  onClose={() => setMonthOpen(false)}
                  load={loadShown}
                  color={color}
                />
              ) : (
                view === "day" && (
                  <motion.div
                    key="week"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease }}
                    className="overflow-hidden"
                  >
                    <WeekStrip day={anchor} now={now} onPick={(d) => (setDir(0), setAnchor(d))} load={loadShown} color={color} version={gen} />
                  </motion.div>
                )
              )}
            </AnimatePresence>
          )}

          {error === "reauth" ? (
            <Notice text="Google needs you to sign in again before it shares your calendar.">
              <GoogleSignIn>
                <button type="submit" className="mt-3 rounded-full bg-ink px-4 py-2 text-sm text-paper">
                  Sign in again
                </button>
              </GoogleSignIn>
            </Notice>
          ) : (
            error && <Notice text={error} onClose={() => setError(null)} />
          )}

          {phone && tab !== "calendar" && !searching ? (
            // Phones: the page picked in the bottom bar, in place of the calendar.
            <div className="mt-1">
              {tab === "today" ? (
                // What now? on top, then the rest of the day (the same as the Today bubble on wide screens).
                <div className="space-y-4">
                  <section aria-label="What now?" className="rounded-2xl border border-line bg-surface p-4">
                    <WhatNowBody onCalendarChange={() => setGen((g) => g + 1)} onPick={setNowPick} />
                  </section>
                  <TodayCard version={gen} onCalendarChange={() => setGen((g) => g + 1)} waiting skip={nowPick} />
                  <Suggestions version={gen} onCalendarChange={() => setGen((g) => g + 1)} />
                </div>
              ) : tab === "priorities" ? (
                <PrioritiesPanel items={priorities} onAction={priorityAction} />
              ) : tab === "mail" ? (
                mailCount === 0 ? (
                  <p className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted">{NO_MAIL}</p>
                ) : (
                  <MailFinds email={email} version={gen} onCalendarChange={() => setGen((g) => g + 1)} onCount={setMailCount} />
                )
              ) : (
                <TodoBody
                  version={gen}
                  now={now}
                  onCalendarChange={() => setGen((g) => g + 1)}
                  onOpenDay={(d) => {
                    openDay(startOfDay(d));
                    setTab("calendar");
                  }}
                  onDragStart={dragTodo}
                />
              )}
            </div>
          ) : (
          <div className="relative lg:mt-4 lg:min-h-0 lg:flex-1">
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
                      <Agenda days={days} events={visible} color={color} severityOf={severityOf} now={now} onOpen={openEvent} isDone={agendaDone} />
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
                        hideHead={phone && view === "day"}
                      />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            )}
          </div>
          )}
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
        {mailOpen && (
          <Modal key="mail" title="Found in your email" onClose={() => setMailOpen(null)} at={mailOpen}>
            {mailCount === 0 ? (
              <p className="text-sm text-muted">{NO_MAIL}</p>
            ) : (
              <MailFinds email={email} version={gen} onCalendarChange={() => setGen((g) => g + 1)} inDialog onCount={setMailCount} />
            )}
          </Modal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {todayAt && (
          <Modal key="today" title="Today" onClose={() => (seeToday(), setTodayAt(null))} at={todayAt} width={320}>
            {/* What now? and today's plan in one: the next step first, then the rest of the day. */}
            <WhatNowBody onCalendarChange={() => setGen((g) => g + 1)} onPick={setNowPick} />
            <h3 className="mt-4 border-t border-line pt-3 font-mono text-[10px] uppercase tracking-[0.25em] text-muted">The rest of today</h3>
            <TodayCard version={gen} onCalendarChange={() => setGen((g) => g + 1)} waiting inDialog skip={nowPick} />
          </Modal>
        )}
        {monthAt && (
          <Modal key="month" label="Pick a day" onClose={() => setMonthAt(null)} at={monthAt} width={320}>
            <MonthPanel
              day={anchor}
              now={now}
              onPick={(d) => {
                setDir(0);
                setAnchor(d);
                setMonthAt(null);
              }}
              onClose={() => setMonthAt(null)}
              load={loadShown}
              color={color}
            />
          </Modal>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {todos && (
          <TodoDialog
            key="todos"
            at={todos instanceof DOMRect ? todos : null}
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
        {review && <Review key="review" onClose={() => setReview(false)} />}
        {addCal && <AddCalendarHelp key="addcal" email={email} onClose={() => setAddCal(false)} />}
        {settings && (
          <Settings
            key="settings"
            name={name}
            email={email}
            onClose={() => {
              setSettings(false);
              setSettingsTab(undefined);
            }}
            startTab={settingsTab}
            stages={stagesNow}
            onStages={setStagesNow}
            planMode={planModeNow}
            mail={mailNow}
            onMail={(on) => setMailNow({ ...mailNow, on })}
            onPlanMode={(m) => {
              setPlanModeNow(m);
              setGen((g) => g + 1);
            }}
            profile={profileNow}
            onEditProfile={() => {
              setSettings(false);
              setAbout(true);
            }}
            onAddAccount={() => {
              setSettings(false);
              setAddCal(true);
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
        {away && <AwayDialog key="away" kind={away} now={now} onClose={() => setAway(null)} onSaved={() => setGen((g) => g + 1)} />}
      </AnimatePresence>

      {mounted && (
        <BottomBar
          tab={tab}
          onTab={(t) => {
            if (t === "today" || tab === "today") seeToday(); // opened it, or leaving it after seeing it
            setTab(t);
            setMonthOpen(false);
            setQuery("");
            setSearchOpen(false);
            scrollTo({ top: 0 });
          }}
          open={openPriorities}
          mail={mailCount ?? 0}
          todayDot={todayDot}
        />
      )}

      <FullScreenAlert onChanged={() => setGen((g) => g + 1)} />

      {!showAssistant && (
        <CreateMenu
          canEdit={!!writable}
          onNew={newEvent}
          onTodo={openTodos}
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

      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-30 max-lg:bottom-[calc(6.25rem+env(safe-area-inset-bottom))] flex flex-col items-center gap-2 px-4">
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
