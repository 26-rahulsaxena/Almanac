"use client";
import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import type { DayPlan, NowAnswer, Pick, WeekReview } from "@/lib/coach";
import { useDialog } from "./use-dialog";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const length = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`);
const hours = (m: number) => (m < 60 ? `${m} min` : `${+(m / 60).toFixed(1)} h`);

async function load<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error === "reauth" ? "Google needs you to sign in again." : (data?.error ?? "Couldn't read your calendar."));
  return data as T;
}

// Books the time a piece of advice suggested; only ever called from a button the person pressed.
async function book(p: Pick, start: Date) {
  const r = await fetch("/api/coach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: p.title, start: start.toISOString(), minutes: p.minutes, todoId: p.todoId }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "Couldn't book it.");
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useDialog<HTMLDivElement>(onClose);
  return (
    <>
      <motion.div className="fixed inset-0 z-40 bg-ink/25 backdrop-blur-[2px]" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4">
        <motion.div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby="coach-title"
          initial={{ scale: 0.95, opacity: 0, y: 12 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.97, opacity: 0, y: 8 }}
          transition={{ type: "spring", damping: 26, stiffness: 340 }}
          className="pointer-events-auto flex max-h-[min(44rem,calc(100dvh-2rem))] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl"
        >
          <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 id="coach-title" className="font-serif text-2xl">
              {title}
            </h2>
            <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-full text-muted hover:bg-ink/5 hover:text-ink">
              ✕
            </button>
          </header>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
        </motion.div>
      </div>
    </>
  );
}

// "What should I do now?": one answer, with the next best one behind "Something else".
export function WhatNow({ onClose, onCalendarChange }: { onClose: () => void; onCalendarChange: () => void }) {
  const [answer, setAnswer] = useState<NowAnswer | null>(null);
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<string | null>(null);

  useEffect(() => {
    load<{ now: NowAnswer }>("/api/coach").then((d) => setAnswer(d.now), (e: Error) => setError(e.message));
  }, []);

  const pick = answer?.picks[i];
  async function blockIt() {
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      const start = new Date(Math.ceil(Date.now() / 300_000) * 300_000); // the next 5 minutes
      await book(pick, start);
      setBooked(`Booked “${pick.title}” until ${time(new Date(+start + pick.minutes * 60_000).toISOString())}.`);
      onCalendarChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="What now?" onClose={onClose}>
      {!answer && !error && <p className="text-sm text-muted">Looking at your day…</p>}
      {answer && (
        <div aria-live="polite">
          {pick ? (
            <>
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent">{i === 0 ? "Do this now" : `Or this (${i + 1} of ${answer.picks.length})`}</p>
              <p className="mt-1 break-words font-serif text-3xl leading-tight">{pick.title}</p>
              <p className="mt-2 text-sm text-muted">{pick.why}</p>
            </>
          ) : (
            <p className="break-words font-serif text-2xl leading-snug">{answer.headline}</p>
          )}
          <p className="mt-3 text-sm">{answer.detail}</p>
          {booked ? (
            <p className="mt-4 rounded-xl bg-ink/5 px-3 py-2 text-sm">{booked}</p>
          ) : (
            pick && (
              <div className="mt-5 flex flex-wrap gap-2">
                <button type="button" data-autofocus disabled={busy || pick.minutes < 5} onClick={blockIt} className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50">
                  {busy ? "Booking…" : `Block ${length(pick.minutes)} for it now`}
                </button>
                {answer.picks.length > 1 && (
                  <button type="button" onClick={() => setI((i + 1) % answer.picks.length)} className="rounded-full border border-line px-4 py-2 text-sm hover:border-ink/40">
                    Something else
                  </button>
                )}
              </div>
            )
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-accent">
          {error}
        </p>
      )}
    </Modal>
  );
}

// Today at a glance, above Priorities: events, free time, and the most important work for each free stretch.
export function TodayCard({ version, onCalendarChange }: { version: number; onCalendarChange: () => void }) {
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load<{ today: DayPlan }>("/api/coach").then((d) => setPlan(d.today), () => {});
  }, [version]);

  async function bookBlock(b: DayPlan["blocks"][number]) {
    setBusy(b.start);
    setError(null);
    try {
      await book(b, new Date(b.start));
      onCalendarChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!plan) return null;
  return (
    <section aria-labelledby="today-title" className="rounded-2xl border border-line bg-surface p-4">
      <h2 id="today-title" className="font-serif text-xl">
        Today
      </h2>
      <p className="mt-0.5 text-sm text-muted">
        {plan.count ? `${plan.count} event${plan.count === 1 ? "" : "s"}` : "No events"}
        {plan.first && ` · first “${plan.first.title}” at ${time(plan.first.start)}`}
        {plan.last && plan.count > 1 && ` · done by ${time(plan.last.end)}`}
        {` · ${hours(plan.freeMinutes)} free`}
      </p>
      {plan.blocks.length > 0 && (
        <ul className="mt-3 space-y-2">
          {plan.blocks.map((b) => (
            <li key={b.start} className="flex items-start gap-3 text-sm">
              <span className="w-16 shrink-0 pt-0.5 font-mono text-xs text-muted">{time(b.start)}</span>
              <span className="min-w-0 flex-1">
                <span className="block break-words leading-snug">{b.title}</span>
                <span className="block text-xs text-muted">
                  {length(b.minutes)} · {b.why}
                </span>
              </span>
              <button type="button" disabled={!!busy} onClick={() => bookBlock(b)} className="shrink-0 rounded-full border border-line px-2.5 py-0.5 text-xs hover:border-ink/40 disabled:opacity-50">
                {busy === b.start ? "Booking…" : "Book"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-accent">
          {error}
        </p>
      )}
    </section>
  );
}

// The week in review: where the last 7 days went, what got done, what slipped.
export function Review({ onClose }: { onClose: () => void }) {
  const [r, setR] = useState<WeekReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    load<WeekReview>("/api/coach?view=week").then(setR, (e: Error) => setError(e.message));
  }, []);
  const day = (ymd: string) => new Date(`${ymd}T12:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" });
  const h3 = "mt-5 font-mono text-xs uppercase tracking-[0.2em] text-muted";

  return (
    <Modal title="Your week" onClose={onClose}>
      {!r && !error && <p className="text-sm text-muted">Adding up the last 7 days…</p>}
      {error && (
        <p role="alert" className="text-sm text-accent">
          {error}
        </p>
      )}
      {r && (
        <>
          <p className="text-sm text-muted">
            {new Date(r.from).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – {new Date(r.to).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} ·{" "}
            {hours(r.totalMinutes)} in events
            {r.busiestDay && ` · busiest: ${day(r.busiestDay.day)} (${hours(r.busiestDay.minutes)})`}
          </p>

          <h3 className={h3}>Where the time went</h3>
          {r.byCategory.length ? (
            <ul className="mt-2 space-y-1 text-sm">
              {r.byCategory.map((c) => (
                <li key={c.category} className="flex justify-between gap-3">
                  <span>{c.label}</span>
                  <span className="tabular-nums text-muted">
                    {hours(c.minutes)} · {Math.round((c.minutes / r.totalMinutes) * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">No timed events in the last 7 days.</p>
          )}

          <h3 className={h3}>Done</h3>
          <p className="mt-2 text-sm">
            {r.deadlines.total ? `${r.deadlines.met} of ${r.deadlines.total} deadlines marked done. ` : ""}
            {r.done.length ? r.done.join(" · ") : "Nothing ticked off this week."}
          </p>

          {(r.overdue.length > 0 || r.unmarked.length > 0) && (
            <>
              <h3 className={h3}>Needs a look</h3>
              {r.overdue.length > 0 && <p className="mt-2 text-sm">Overdue to-dos: {r.overdue.join(" · ")}</p>}
              {r.unmarked.length > 0 && <p className="mt-1 text-sm text-muted">Deadlines not marked done: {r.unmarked.join(" · ")}</p>}
            </>
          )}
        </>
      )}
    </Modal>
  );
}
