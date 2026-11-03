"use client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

type TimeOfDay = "morning" | "afternoon" | "evening" | "any";
type Routine = { id: string; title: string; minutes: number; per_week: number; time_of_day: TimeOfDay };
type Draft = { title: string; minutes: number; perWeek: number; timeOfDay: TimeOfDay };

const LENGTHS = [15, 30, 45, 60, 90, 120, 180, 240];
const TIMES: Record<TimeOfDay, string> = { morning: "Mornings (8–12)", afternoon: "Afternoons (12–5)", evening: "Evenings (5–10)", any: "Any time (8–10)" };
const length = (m: number) => (m < 60 ? `${m} min` : `${+(m / 60).toFixed(1)} h`);
const often = (n: number) => (n === 7 ? "Every day" : `${n}× a week`);
const blank: Draft = { title: "", minutes: 60, perWeek: 3, timeOfDay: "evening" };
const field = "w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50";

async function call(method: "GET" | "POST" | "PATCH" | "DELETE", body?: object) {
  const r = await fetch("/api/routines", { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error === "reauth" ? "Google needs you to sign in again." : (data?.error ?? "Something went wrong."));
  return data as Routine[];
}

function Fields({ d, set }: { d: Draft; set: (d: Draft) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      <label className="text-xs text-muted">
        How long
        <select value={d.minutes} onChange={(e) => set({ ...d, minutes: +e.target.value })} className={`${field} mt-0.5`}>
          {LENGTHS.map((m) => (
            <option key={m} value={m}>
              {length(m)}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-muted">
        How often
        <select value={d.perWeek} onChange={(e) => set({ ...d, perWeek: +e.target.value })} className={`${field} mt-0.5`}>
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <option key={n} value={n}>
              {often(n)}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs text-muted">
        When
        <select value={d.timeOfDay} onChange={(e) => set({ ...d, timeOfDay: e.target.value as TimeOfDay })} className={`${field} mt-0.5`}>
          {(Object.keys(TIMES) as TimeOfDay[]).map((t) => (
            <option key={t} value={t}>
              {TIMES[t]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

// Focus time and habits ("Deep work, 2 h, every day, mornings"; "Gym, 3× a week, evenings"). Almanac books the
// sessions in your free time and moves them when something else needs that time.
export function Routines({ onCalendarChange }: { onCalendarChange: () => void }) {
  const [list, setList] = useState<Routine[] | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [editing, setEditing] = useState<{ id: string; d: Draft } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call("GET").then(setList, (e: Error) => setError(e.message));
  }, []);

  async function change(id: string, method: "POST" | "PATCH" | "DELETE", body: object) {
    setBusy(id);
    setError(null);
    try {
      setList(await call(method, body));
      onCalendarChange();
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
    if (draft.title.trim() && (await change("new", "POST", draft))) setDraft(blank);
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (editing && (await change(editing.id, "PATCH", { id: editing.id, ...editing.d }))) setEditing(null);
  }

  const small = "rounded-full border border-line px-2.5 py-0.5 text-xs hover:border-ink/40";
  return (
    <div className="mt-3 space-y-2 text-sm">
      <form onSubmit={add} className="space-y-1.5">
        <label className="block">
          <span className="sr-only">New habit or focus time</span>
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            maxLength={100}
            placeholder="Add a habit or focus time, e.g. Gym…"
            className={field}
          />
        </label>
        {draft.title.trim() && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="space-y-1.5">
            <Fields d={draft} set={setDraft} />
            <button type="submit" disabled={busy === "new"} className="rounded-full bg-ink px-3 py-1.5 font-medium text-paper disabled:opacity-50">
              {busy === "new" ? "Adding and planning…" : "Add"}
            </button>
          </motion.div>
        )}
      </form>

      {list?.length === 0 && <p className="text-xs text-muted">None yet. Almanac keeps time for these each week and moves them when plans change.</p>}
      <ul className="space-y-1">
        <AnimatePresence initial={false}>
          {list?.map((r) => (
            <motion.li key={r.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="group rounded-lg px-1 py-1 hover:bg-ink/[0.03]">
              {editing?.id === r.id ? (
                <form onSubmit={save} className="space-y-1.5 py-1">
                  <label className="block">
                    <span className="sr-only">Name</span>
                    <input autoFocus value={editing.d.title} onChange={(e) => setEditing({ id: r.id, d: { ...editing.d, title: e.target.value } })} maxLength={100} className={field} />
                  </label>
                  <Fields d={editing.d} set={(d) => setEditing({ id: r.id, d })} />
                  <p className="text-xs text-muted">Sessions already booked keep their time; missing ones are added.</p>
                  <div className="flex gap-1.5">
                    <button type="submit" disabled={busy === r.id || !editing.d.title.trim()} className="rounded-full bg-ink px-3 py-1 text-xs font-medium text-paper disabled:opacity-50">
                      {busy === r.id ? "Saving…" : "Save"}
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className="rounded-full px-3 py-1 text-xs text-muted hover:text-ink">
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="break-words leading-snug">{r.title}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {length(r.minutes)} · {often(r.per_week)} · {TIMES[r.time_of_day].replace(/ \(.*/, "").toLowerCase()}
                    </p>
                    {removing === r.id && (
                      <div role="group" aria-label="Remove its upcoming sessions too?" className="mt-1.5 rounded-lg border border-line p-2 text-xs">
                        <p>Also delete its upcoming sessions from your calendar?</p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          <button type="button" disabled={busy === r.id} onClick={() => change(r.id, "DELETE", { id: r.id, removeBlocks: true })} className="rounded-full bg-accent px-2.5 py-0.5 font-medium text-white">
                            Delete them too
                          </button>
                          <button type="button" disabled={busy === r.id} onClick={() => change(r.id, "DELETE", { id: r.id, removeBlocks: false })} className={small}>
                            Keep them
                          </button>
                          <button type="button" onClick={() => setRemoving(null)} className="px-2 text-muted hover:text-ink">
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditing({ id: r.id, d: { title: r.title, minutes: r.minutes, perWeek: r.per_week, timeOfDay: r.time_of_day } })}
                    aria-label={`Edit ${r.title}`}
                    title="Edit"
                    className="text-muted opacity-60 hover:text-ink group-hover:opacity-100"
                  >
                    ✎
                  </button>
                  <button type="button" onClick={() => setRemoving(r.id)} aria-label={`Stop ${r.title}`} title="Remove" className="text-muted opacity-60 hover:text-ink group-hover:opacity-100">
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
