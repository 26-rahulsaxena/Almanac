"use client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { TodayCard, WhatNowBody } from "./coach";
import { TodayTiles, type Counts, type TileTarget } from "./today-tiles";

// The same shape as lib/home.ts sends.
type Item = {
  key: string;
  source: "todo" | "calendar" | "email" | "plan";
  title: string;
  when: string;
  allDay: boolean;
  severity: "low" | "medium" | "high" | "critical" | null;
  note: string;
  fit: { start: string; end: string } | null;
  booked: string | null;
  act:
    | { kind: "todo"; id: string; suggestion?: string }
    | { kind: "priority"; calendarId: string; eventId: string; prep?: string }
    | { kind: "find"; id: string; pickTime: boolean }
    | { kind: "suggestion"; id: string; move: boolean };
};
type Group = "today" | "overdue" | "week" | "month";
type List = Record<Group, Item[]>;

const GROUPS: [Group, string, string][] = [
  ["today", "Today", "Nothing due today."],
  ["overdue", "Overdue", ""],
  ["week", "This week", ""],
  ["month", "This month", ""],
];
const SOURCE: Record<Item["source"], string> = { todo: "To-do", calendar: "Calendar", email: "Email", plan: "Suggestion" };
const SEVERITY_DOT: Record<NonNullable<Item["severity"]>, string> = { critical: "var(--sev-critical)", high: "var(--sev-high)", medium: "var(--sev-medium)", low: "var(--sev-low)" };

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const dayTime = (iso: string, allDay = false) => {
  const d = new Date(iso);
  const today = d.toDateString() === new Date().toDateString();
  const day = today ? "" : d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  return allDay ? day || "Today" : `${day}${day ? ", " : ""}${time(iso)}`;
};
const whenText = (it: Item) => (it.source === "todo" || it.source === "calendar" ? `${it.source === "todo" ? "Due " : ""}${dayTime(it.when, it.allDay)}` : dayTime(it.when));

// Home: one card with the next step (What now?) and the rest of today's plan with its timings, the day at a glance
// (tiles), then everything to do from everywhere in one list: Today, Overdue, This week, This month. children: the
// full Priorities, beside the list on wide screens and under it on phones.
export function Home({
  version,
  wide,
  greeting,
  onCalendarChange,
  onOpen,
  children,
}: {
  version: number;
  wide: boolean;
  greeting: string;
  onCalendarChange: () => void;
  onOpen: (t: TileTarget) => void;
  children?: ReactNode;
}) {
  const [nowPick, setNowPick] = useState<string | null>(null); // What now?'s pick, left out of the plan under it
  // To-dos with a card of their own in Today or Overdue: booked from that card, so the plan doesn't offer them too.
  const [listed, setListed] = useState<string[]>([]);
  // The tiles' numbers, read again when the calendar or to-dos change and every 5 minutes.
  const [day, setDay] = useState<Counts | null>(null);
  useEffect(() => {
    const load = () =>
      fetch("/api/today")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setDay(d))
        .catch(() => {});
    load();
    const id = setInterval(load, 5 * 60_000);
    return () => clearInterval(id);
  }, [version]);

  return (
    <div className="lg:grid lg:h-[calc(100dvh-5rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-6">
      <div className="min-w-0 space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1 lg:pb-24">
        {wide && <h1 className="font-serif text-4xl">{greeting}</h1>}
        {/* What now? and today's plan as one card, so nothing is suggested twice: the plan leaves out What now?'s
            pick and the to-dos that have their own card below. */}
        <section aria-label="What now and today's plan" className="rounded-2xl border border-line bg-surface p-4">
          <WhatNowBody onCalendarChange={onCalendarChange} onPick={setNowPick} />
          <div className="mt-3 border-t border-line pt-3">
            <TodayCard version={version} onCalendarChange={onCalendarChange} waiting inDialog skip={nowPick} skipTodos={listed} />
          </div>
        </section>
        <TodayTiles c={day} onOpen={onOpen} />
        <ActionList version={version} onCalendarChange={onCalendarChange} onOpen={onOpen} onListed={setListed} />
        {!wide && children}
      </div>
      {wide && <aside className="min-w-0 space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pb-24">{children}</aside>}
    </div>
  );
}

// Everything to do, grouped. Each card has one main button: Book (it fits free time), Add (from email), or Done;
// one that can't be booked says why and offers the next step instead. onListed: the to-dos with a card in Today or
// Overdue, each time the list is read.
function ActionList({ version, onCalendarChange, onOpen, onListed }: { version: number; onCalendarChange: () => void; onOpen: (t: TileTarget) => void; onListed: (todos: string[]) => void }) {
  const [list, setList] = useState<List | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mine, setMine] = useState(0); // bumps after this list's own changes, to read it again
  // Which groups are open: Today and Overdue to start with; This week and This month folded until tapped.
  const [shown, setShown] = useState<Set<Group>>(() => new Set(["today", "overdue"]));
  const fold = (g: Group) =>
    setShown((s) => {
      const next = new Set(s);
      if (!next.delete(g)) next.add(g);
      return next;
    });

  useEffect(() => {
    fetch("/api/home")
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (r.ok) {
          setList(d);
          onListed([...d.today, ...d.overdue].flatMap((it: Item) => (it.act.kind === "todo" ? [it.act.id] : [])));
        }
        else setError(d?.error === "reauth" ? "Google needs you to sign in again." : (d?.error ?? "Couldn't load your list."));
      })
      .catch(() => setError("Couldn't load your list. Check your connection."));
  }, [version, mine, onListed]);

  // Runs one button: the source's own API, then the list (and the calendar) again.
  async function run(it: Item, label: string, url: string, method: string, body: object) {
    setBusy(`${it.key}:${label}`);
    setError(null);
    try {
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        setError(d?.error === "reauth" ? "Google needs you to sign in again." : (d?.error ?? "That didn't work. Try again."));
      }
      onCalendarChange();
      setMine((m) => m + 1);
    } catch {
      setError("That didn't work. Check your connection.");
    } finally {
      setBusy(null);
    }
  }

  // The buttons for one item: [label, primary, action].
  const buttons = (it: Item): [string, boolean, () => void][] => {
    const a = it.act;
    switch (a.kind) {
      case "todo":
        return [
          ...(!it.booked
            ? [[it.fit ? "Book" : "Book a time", !!it.fit, () =>
                a.suggestion
                  ? run(it, "Book", "/api/suggestions", "POST", { id: a.suggestion, action: "approve" })
                  : run(it, "Book", "/api/todos", "PATCH", { id: a.id, schedule: true, ...(it.fit && { start: it.fit.start }) })] as [string, boolean, () => void]]
            : []),
          ["Done", !!it.booked, () => run(it, "Done", "/api/todos", "PATCH", { id: a.id, done: true })],
        ];
      case "priority":
        return [
          ...(a.prep ? [["Book prep", true, () => run(it, "Book prep", "/api/coach", "POST", { fit: a.prep })] as [string, boolean, () => void]] : []),
          ["Done", !a.prep, () => run(it, "Done", "/api/priorities", "POST", { calendarId: a.calendarId, eventId: a.eventId, action: "done" })],
        ];
      case "find":
        return [
          a.pickTime ? ["Pick a time", true, () => onOpen("mail")] : ["Add", true, () => run(it, "Add", "/api/mail", "POST", { id: a.id, action: "add" })],
          ["Not now", false, () => run(it, "Not now", "/api/mail", "POST", { id: a.id, action: "dismiss" })],
        ];
      case "suggestion":
        return [
          [a.move ? "Move" : "Book", true, () => run(it, "Book", "/api/suggestions", "POST", { id: a.id, action: "approve" })],
          ["Not now", false, () => run(it, "Not now", "/api/suggestions", "POST", { id: a.id, action: "dismiss" })],
        ];
    }
  };

  if (!list) return error ? <p className="text-sm text-accent">{error}</p> : <p className="text-sm text-muted">Putting your list together…</p>;
  return (
    <section id="things-to-do" aria-label="Things to do" className="scroll-mt-24 space-y-5">
      {error && (
        <p role="alert" className="rounded-xl bg-accent/10 px-3 py-2 text-xs text-accent">
          {error}
        </p>
      )}
      {GROUPS.map(([g, label, empty]) =>
        !list[g].length && g !== "today" ? null : ( // Today shows even when empty, to say so
          <div key={g}>
            <h2>
              <button
                type="button"
                onClick={() => fold(g)}
                aria-expanded={shown.has(g)}
                className={`flex w-full items-center gap-2 rounded-lg py-1 text-left font-mono text-[10px] uppercase tracking-[0.25em] hover:text-ink ${g === "overdue" ? "text-accent" : "text-muted"}`}
              >
                <svg className={`size-3 shrink-0 transition-transform ${shown.has(g) ? "rotate-90" : ""}`} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="m4.5 2.5 3.5 3.5-3.5 3.5" />
                </svg>
                {label} {list[g].length > 0 && <span>· {list[g].length}</span>}
              </button>
            </h2>
            {shown.has(g) && !list[g].length && <p className="mt-2 text-sm text-muted">{empty}</p>}
            {shown.has(g) && (
            <ul className="mt-2 space-y-2">
              <AnimatePresence initial={false}>
                {list[g].map((it) => (
                  <motion.li
                    key={it.key}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    className={`rounded-2xl border bg-surface p-3 ${!it.fit && !it.booked && it.act.kind !== "priority" ? "border-dashed border-ink/25" : "border-line"}`}
                  >
                    <div className="flex items-start gap-2">
                      {it.severity && <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: SEVERITY_DOT[it.severity] }} aria-label={`${it.severity} priority`} />}
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-medium leading-snug">{it.title}</p>
                        <p className="mt-0.5 text-xs text-muted">
                          <span className="font-semibold text-ink">{whenText(it)}</span> · {SOURCE[it.source]}
                        </p>
                        <p className="mt-0.5 break-words text-xs text-muted">{it.note}</p>
                        {(it.fit || it.booked) && (
                          <p className="mt-1 text-xs">
                            {it.booked ? (
                              <>Booked {dayTime(it.booked)}</>
                            ) : (
                              <>
                                <span className="rounded bg-[var(--cat-2)]/15 px-1 font-medium">Free</span> {dayTime(it.fit!.start)}–{time(it.fit!.end)}
                              </>
                            )}
                          </p>
                        )}
                      </div>
                      {/* The buttons sit on the right, beside the words, so a card is no taller than its text. */}
                      <div className="flex max-w-[50%] shrink-0 flex-wrap justify-end gap-1.5 self-center">
                      {buttons(it).map(([label, primary, go]) => (
                        <button
                          key={label}
                          type="button"
                          disabled={!!busy}
                          onClick={go}
                          className={`rounded-full px-3 py-1 text-xs disabled:opacity-50 ${primary ? "bg-ink font-medium text-paper" : "border border-line hover:border-ink/40"}`}
                        >
                          {busy === `${it.key}:${label}` ? "…" : label}
                        </button>
                      ))}
                      </div>
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
            )}
          </div>
        ),
      )}
    </section>
  );
}
