"use client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { length } from "@/lib/time";
import { Select } from "./select";

type Todo = {
  id: string;
  title: string;
  due_at: string | null;
  minutes: number;
  done: boolean;
  event_id: string | null;
  scheduled_at: string | null;
  auto: boolean;
};
type Draft = { title: string; due: string; minutes: number; auto: boolean; split: number | null };

const LENGTHS = [15, 30, 60, 90, 120, 180, 240, 360, 480];
const SESSIONS = [45, 60, 90, 120];
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
// An ISO time as the value a datetime-local box expects, in the browser's own time zone.
const localInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(+d - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const blank: Draft = { title: "", due: "", minutes: 60, auto: true, split: null };

async function call(method: "GET" | "POST" | "PATCH" | "DELETE", body?: object) {
  const r = await fetch("/api/todos", { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error === "reauth" ? "Google needs you to sign in again." : (data?.error ?? "Something went wrong."));
  return data as Todo[];
}

const field = "w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50";

// Due, length and "book automatically", shared by the add form and editing.
function Details({ d, set, splittable }: { d: Draft; set: (d: Draft) => void; splittable: boolean }) {
  return (
    <>
      <label className="block text-xs text-muted">
        Due (optional)
        <input type="datetime-local" value={d.due} onChange={(e) => set({ ...d, due: e.target.value })} className={`${field} mt-0.5`} />
      </label>
      <label className="block text-xs text-muted">
        Takes
        <Select
          value={String(d.minutes)}
          onChange={(v) => set({ ...d, minutes: +v, split: null })}
          className={`${field} mt-0.5`}
          options={[...new Set([...LENGTHS, d.minutes])].sort((a, b) => a - b).map((m) => [String(m), length(m)])}
        />
      </label>
      {splittable && d.minutes >= 120 && (
        <label className="block text-xs text-muted">
          Split into sessions
          <Select
            value={String(d.split ?? "")}
            onChange={(v) => set({ ...d, split: v ? +v : null })}
            className={`${field} mt-0.5`}
            options={[
              ["", "No, one block"],
              ...SESSIONS.filter((s) => s < d.minutes).map((s): [string, string] => [String(s), `${Math.ceil(d.minutes / s)} sessions of up to ${length(s)}, on different days`]),
            ]}
          />
        </label>
      )}
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" checked={d.auto} onChange={(e) => set({ ...d, auto: e.target.checked })} className="mt-0.5 accent-[var(--accent)]" />
        <span>
          Let Almanac plan a time for it
          <span className="block text-muted">It finds free time before it&apos;s due and keeps it clear when plans change. In Ask-first mode you approve each change.</span>
        </span>
      </label>
    </>
  );
}

// To-dos, in the menu and the "+ To-do" pop-up. Add, edit, tick off, remove; "Find time" or "book automatically"
// puts them on the calendar (and in Priorities), and ticking one off also ticks off its calendar block.
// `version` changes when something else (the assistant) may have edited the list; `onCalendarChange` refreshes the calendar.
export function TodoList({
  version,
  now,
  onCalendarChange,
  onOpenDay,
  onDragStart,
  autoFocus,
}: {
  version: number;
  now: Date;
  onCalendarChange: () => void;
  onOpenDay: (d: Date) => void;
  onDragStart: (t: Todo, x: number, y: number) => void; // a to-do picked up by its grip, to drop on the calendar
  autoFocus?: boolean;
}) {
  const [todos, setTodos] = useState<Todo[] | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [editing, setEditing] = useState<{ id: string; d: Draft } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null); // asking "also remove its calendar block?"
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call("GET").then(setTodos, (e: Error) => setError(e.message));
  }, [version]);

  async function change(id: string, method: "POST" | "PATCH" | "DELETE", body: object) {
    setBusy(id);
    setError(null);
    try {
      setTodos(await call(method, body));
      onCalendarChange(); // to-dos show on the calendar, so every change is a calendar change
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  const iso = (local: string) => (local ? new Date(local).toISOString() : null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) return;
    const ok = await change("new", "POST", { title: draft.title, minutes: draft.minutes, due: iso(draft.due), auto: draft.auto, split: draft.split });
    if (ok) setDraft(blank);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const { id, d } = editing;
    if (await change(id, "PATCH", { id, title: d.title, minutes: d.minutes, due: iso(d.due), auto: d.auto })) setEditing(null);
  }

  async function remove(t: Todo, removeBlock: boolean) {
    setRemoving(null);
    await change(t.id, "DELETE", { id: t.id, removeBlock });
  }

  const soon = (iso: string) => +new Date(iso) - +now < 24 * 3_600_000;
  const small = "rounded-full border border-line px-2.5 py-0.5 text-xs hover:border-ink/40 disabled:opacity-50";

  return (
    <div className="mt-3 space-y-2 text-sm">
      <form onSubmit={add} className="space-y-1.5">
        <label className="block">
          <span className="sr-only">New to-do</span>
          <input
            data-autofocus={autoFocus || undefined}
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            maxLength={200}
            placeholder="Add a to-do…"
            className={field}
          />
        </label>
        {/* Always shown, so due date, length and planning can be set before or after the name. */}
        <Details d={draft} set={setDraft} splittable />
        <button type="submit" disabled={busy === "new" || !draft.title.trim()} className="rounded-full bg-ink px-3 py-1.5 font-medium text-paper disabled:opacity-50">
          {busy === "new" ? (draft.auto ? "Adding and planning…" : "Adding…") : "Add"}
        </button>
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
              {editing?.id === t.id ? (
                <form onSubmit={save} className="space-y-1.5 py-1">
                  <label className="block">
                    <span className="sr-only">To-do</span>
                    <input
                      autoFocus
                      value={editing.d.title}
                      onChange={(e) => setEditing({ id: t.id, d: { ...editing.d, title: e.target.value } })}
                      maxLength={200}
                      className={field}
                    />
                  </label>
                  <Details d={editing.d} set={(d) => setEditing({ id: t.id, d })} splittable={false} />
                  <div className="flex gap-1.5">
                    <button type="submit" disabled={busy === t.id || !editing.d.title.trim()} className="rounded-full bg-ink px-3 py-1 text-xs font-medium text-paper disabled:opacity-50">
                      {busy === t.id ? "Saving…" : "Save"}
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className="rounded-full px-3 py-1 text-xs text-muted hover:text-ink">
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex items-start gap-2">
                  {!t.done && !t.event_id && (
                    // Mouse or finger: pick it up here and drop it on a time in the calendar. ("Find time" does it by keyboard.)
                    <span
                      aria-hidden
                      title="Drag onto the calendar to book a time"
                      onPointerDown={(pe) => {
                        if (pe.button !== 0) return;
                        pe.preventDefault();
                        pe.currentTarget.releasePointerCapture?.(pe.pointerId);
                        onDragStart(t, pe.clientX, pe.clientY);
                      }}
                      className="-ml-1 mt-0.5 cursor-grab touch-none select-none px-0.5 text-sm leading-none text-muted hover:text-ink"
                    >
                      ⠿
                    </span>
                  )}
                  <motion.button
                    type="button"
                    role="checkbox"
                    aria-checked={t.done}
                    aria-label={`${t.done ? "Not done" : "Done"}: ${t.title}`}
                    disabled={busy === t.id}
                    onClick={() => change(t.id, "PATCH", { id: t.id, done: !t.done })}
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
                        {t.auto && <span title="Almanac keeps a time for it">Auto</span>}
                      </p>
                    )}
                    {!t.done &&
                      (t.scheduled_at ? (
                        <button type="button" onClick={() => onOpenDay(new Date(t.scheduled_at!))} className="mt-0.5 text-xs underline decoration-line underline-offset-2 hover:text-ink">
                          On calendar {when(t.scheduled_at)}
                        </button>
                      ) : t.auto ? (
                        <p className="mt-0.5 text-xs text-muted">Not booked yet: approve the time under “Almanac suggests” (or it books itself in Automatic mode).</p>
                      ) : (
                        <button type="button" disabled={busy === t.id} onClick={() => change(t.id, "PATCH", { id: t.id, schedule: true })} className={`mt-1 ${small}`}>
                          {busy === t.id ? "Finding time…" : "Find time"}
                        </button>
                      ))}
                    {removing === t.id && (
                      <div role="group" aria-label="Remove its calendar block too?" className="mt-1.5 rounded-lg border border-line p-2 text-xs">
                        <p>It has a block on your calendar. Remove that too?</p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          <button type="button" onClick={() => remove(t, true)} className="rounded-full bg-accent px-2.5 py-0.5 font-medium text-white">
                            Remove both
                          </button>
                          <button type="button" onClick={() => remove(t, false)} className={small}>
                            Keep the block
                          </button>
                          <button type="button" onClick={() => setRemoving(null)} className="px-2 text-muted hover:text-ink">
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  {!t.done && (
                    <button
                      type="button"
                      onClick={() => setEditing({ id: t.id, d: { title: t.title, due: localInput(t.due_at), minutes: t.minutes, auto: t.auto, split: null } })}
                      aria-label={`Edit ${t.title}`}
                      title="Edit"
                      className="-m-1 p-1 text-muted hover:text-ink"
                    >
                      ✎
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => (t.event_id && !t.done ? setRemoving(t.id) : remove(t, false))}
                    aria-label={`Remove ${t.title} from the list`}
                    title="Remove"
                    className="-m-1 p-1 text-muted hover:text-ink"
                  >
                    ✕
                  </button>
                </div>
              )}
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
