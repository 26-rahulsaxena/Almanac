"use client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

type Todo = { id: string; title: string; due_at: string | null; minutes: number; done: boolean; event_id: string | null; scheduled_at: string | null };

const LENGTHS = [15, 30, 60, 90, 120, 180];
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const length = (m: number) => (m < 60 ? `${m} min` : `${m / 60} h`);

async function call(method: "GET" | "POST" | "PATCH" | "DELETE", body?: object) {
  const r = await fetch("/api/todos", { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error === "reauth" ? "Google needs you to sign in again." : (data?.error ?? "Something went wrong."));
  return data as Todo[];
}

// To-dos in the sidebar. "Find time" books the first free slot before it's due, so it lands on the calendar
// (and in Priorities); ticking it off also ticks off that calendar block.
// `version` changes when something else (the assistant) may have edited the list; `onCalendarChange` refreshes the calendar.
export function TodoList({
  version,
  now,
  onCalendarChange,
  onOpenDay,
}: {
  version: number;
  now: Date;
  onCalendarChange: () => void;
  onOpenDay: (d: Date) => void;
}) {
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call("GET").then(setTodos, (e: Error) => setError(e.message));
  }, [version]);

  async function change(id: string, method: "POST" | "PATCH" | "DELETE", body: object, calendar = false) {
    setBusy(id);
    setError(null);
    try {
      setTodos(await call(method, body));
      if (calendar) onCalendarChange();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const ok = await change("new", "POST", { title, minutes, due: due ? new Date(due).toISOString() : null });
    if (ok) {
      setTitle("");
      setDue("");
    }
  }

  const field = "w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50";
  const soon = (iso: string) => +new Date(iso) - +now < 24 * 3_600_000;

  return (
    <div className="mt-3 space-y-2 text-sm">
      <form onSubmit={add} className="space-y-1.5">
        <label className="block">
          <span className="sr-only">New to-do</span>
          <input id="new-todo" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="Add a to-do…" className={field} />
        </label>
        {title.trim() && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="space-y-1.5">
            <label className="block text-xs text-muted">
              Due (optional)
              <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className={`${field} mt-0.5`} />
            </label>
            <div className="flex items-center gap-1.5">
              <label className="min-w-0 flex-1 text-xs text-muted">
                Takes
                <select value={minutes} onChange={(e) => setMinutes(+e.target.value)} className={`${field} mt-0.5`}>
                  {LENGTHS.map((m) => (
                    <option key={m} value={m}>
                      {length(m)}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={busy === "new"} className="mt-4 rounded-full bg-ink px-3 py-1.5 font-medium text-paper disabled:opacity-50">
                Add
              </button>
            </div>
          </motion.div>
        )}
      </form>

      {todos?.length === 0 && <p className="text-xs text-muted">Nothing to do. Add things here, or ask the assistant.</p>}
      <ul className="space-y-1">
        <AnimatePresence initial={false}>
          {todos?.map((t) => (
            <motion.li
              key={t.id}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="group rounded-lg px-1 py-1 hover:bg-ink/[0.03]"
            >
              <div className="flex items-start gap-2">
                <motion.button
                  type="button"
                  role="checkbox"
                  aria-checked={t.done}
                  aria-label={`${t.done ? "Not done" : "Done"}: ${t.title}`}
                  disabled={busy === t.id}
                  onClick={() => change(t.id, "PATCH", { id: t.id, done: !t.done }, !!t.event_id)}
                  whileTap={{ scale: 0.8 }}
                  className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border-2 text-[9px] text-paper ${t.done ? "border-ink bg-ink" : "border-muted"}`}
                >
                  {t.done && "✓"}
                </motion.button>
                <div className="min-w-0 flex-1">
                  <p className={`break-words leading-snug ${t.done ? "text-muted line-through" : ""}`}>{t.title}</p>
                  {!t.done && (
                    <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
                      <span>{length(t.minutes)}</span>
                      {t.due_at && <span className={soon(t.due_at) ? "font-medium text-accent" : ""}>Due {when(t.due_at)}</span>}
                    </p>
                  )}
                  {!t.done &&
                    (t.scheduled_at ? (
                      <button type="button" onClick={() => onOpenDay(new Date(t.scheduled_at!))} className="mt-0.5 text-xs underline decoration-line underline-offset-2 hover:text-ink">
                        On calendar {when(t.scheduled_at)}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy === t.id}
                        onClick={() => change(t.id, "PATCH", { id: t.id, schedule: true }, true)}
                        className="mt-1 rounded-full border border-line px-2.5 py-0.5 text-xs hover:border-ink/40 disabled:opacity-50"
                      >
                        {busy === t.id ? "Finding time…" : "Find time"}
                      </button>
                    ))}
                </div>
                <button
                  type="button"
                  onClick={() => change(t.id, "DELETE", { id: t.id })}
                  aria-label={`Remove ${t.title} from the list`}
                  title={t.event_id ? "Remove from the list (the calendar block stays)" : "Remove"}
                  className="text-muted opacity-60 hover:text-ink group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {error && (
        <p role="alert" className="text-xs text-accent">
          {error}
        </p>
      )}
    </div>
  );
}
