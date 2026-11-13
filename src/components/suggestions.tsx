"use client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { setPlanMode } from "@/app/actions";

type Suggestion = {
  id: string;
  kind: "todo" | "routine" | "event";
  title: string;
  reason: "new" | "clash" | "rollover";
  from_start: string | null;
  to_start: string;
  to_end: string;
};
export type PlanMode = "ask" | "auto";

const day = (iso: string) => new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const WHY = { new: "free time that fits", clash: "something else is now at its time", rollover: "it wasn't finished" };

// The auto-planner's suggestions (Ask-first mode). Nothing changes on the calendar until you press OK.
// Shows nothing when there's nothing to approve.
export function Suggestions({ version, onCalendarChange }: { version: number; onCalendarChange: () => void }) {
  const [list, setList] = useState<Suggestion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/suggestions")
      .then((r) => (r.ok ? r.json() : null))
      .then((l: Suggestion[] | null) => l && setList(l))
      .catch(() => {});
  }, [version]);

  async function answer(id: string, body: object, approve: boolean) {
    setBusy(id);
    setError(null);
    try {
      const r = await fetch("/api/suggestions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await r.json().catch(() => null);
      if (Array.isArray(data)) setList(data);
      else if (data?.list) setList(data.list);
      if (!r.ok) setError(data?.error === "reauth" ? "Google needs you to sign in again." : (data?.error ?? "Couldn't make that change. Try again."));
      if (approve) onCalendarChange();
    } finally {
      setBusy(null);
    }
  }

  if (!list?.length) return null;
  return (
    <motion.section
      aria-labelledby="suggestions-title"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-accent/50 bg-surface p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="suggestions-title" className="font-serif text-xl">
          Almanac suggests
        </h2>
        {list.length > 1 && (
          <button type="button" disabled={!!busy} onClick={() => answer("all", { all: true, action: "approve" }, true)} className="shrink-0 text-xs font-medium text-accent hover:underline disabled:opacity-50">
            {busy === "all" ? "Approving…" : `Approve all ${list.length}`}
          </button>
        )}
      </div>
      <ul className="mt-3 space-y-2.5">
        <AnimatePresence initial={false}>
          {list.map((s) => (
            <motion.li key={s.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="text-sm">
              <p className="break-words leading-snug">
                {s.from_start ? "Move" : s.kind === "routine" ? "Book a session of" : "Book time for"} <b className="font-medium">{s.title}</b>
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {s.from_start ? `${day(s.from_start)} → ${day(s.to_start)}` : `${day(s.to_start)} – ${time(s.to_end)}`} · {s.kind === "event" ? "it clashes with another event today" : WHY[s.reason]}
              </p>
              <div className="mt-1.5 flex gap-1.5">
                <button type="button" disabled={!!busy} onClick={() => answer(s.id, { id: s.id, action: "approve" }, true)} className="rounded-full bg-ink px-3 py-1 text-xs font-medium text-paper disabled:opacity-50">
                  {busy === s.id ? "Doing it…" : "✓ OK"}
                </button>
                <button type="button" disabled={!!busy} onClick={() => answer(s.id, { id: s.id, action: "dismiss" }, false)} className="rounded-full border border-line px-3 py-1 text-xs hover:border-ink/40 disabled:opacity-50">
                  Not now
                </button>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {error && (
        <p role="alert" className="mt-2 text-xs text-accent">
          {error}
        </p>
      )}
    </motion.section>
  );
}

// Menu setting: whether the auto-planner asks first or acts by itself.
export function PlanModeSetting({ initial, onChange }: { initial: PlanMode; onChange: (m: PlanMode) => void }) {
  const [mode, setMode] = useState(initial);
  const [error, setError] = useState(false);
  function pick(m: PlanMode) {
    const before = mode;
    setMode(m);
    setError(false);
    setPlanMode(m).then(() => onChange(m), () => {
      setMode(before);
      setError(true);
    });
  }
  const options: [PlanMode, string, string][] = [
    ["ask", "Ask me first", "Almanac suggests bookings and moves; nothing changes until you press OK."],
    ["auto", "Automatic", "Almanac books and moves its own blocks by itself, and tells you afterwards."],
  ];
  return (
    <fieldset className="mt-3 space-y-2 text-sm">
      <legend className="sr-only">Planning mode</legend>
      {options.map(([v, label, help]) => (
        <label key={v} className="flex items-start gap-2">
          <input type="radio" name="plan-mode" value={v} checked={mode === v} onChange={() => pick(v)} className="mt-1 accent-[var(--accent)]" />
          <span>
            <b className="font-medium">{label}</b>
            <span className="block text-xs text-muted">{help}</span>
          </span>
        </label>
      ))}
      {error && <p className="text-xs text-accent">Couldn&apos;t save. Try again.</p>}
    </fieldset>
  );
}
