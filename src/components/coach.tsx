"use client";
import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { length } from "@/lib/time";
import { startChoices, type DayPlan, type NowAnswer, type Pick, type PrepState, type WeekReview } from "@/lib/coach";
import { TimeWheel } from "./time-wheel";
import { useDialog } from "./use-dialog";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const dayTime = (iso: string) => new Date(iso).toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit" });
// "Not now" on an at-risk warning hides it on this device until tomorrow: {"<today>": [deadline keys]}.
const RISK_NOT_NOW = "prepRiskNotNow";
const todayKey = () => new Date().toDateString();
const hours = (m: number) => length(Math.round(m / 5) * 5); // totals, to the nearest 5 min

async function load<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error === "reauth" ? "Google needs you to sign in again." : (data?.error ?? "Couldn't read your calendar."));
  return data as T;
}

// Books the time a piece of advice suggested; only ever called from a button the person pressed. check: a time the
// person picked, so if it overlaps something nothing is booked and what it overlaps comes back (force: book anyway).
async function book(p: Pick, start: Date, opts: { check?: boolean; force?: boolean } = {}): Promise<string | null> {
  const r = await fetch("/api/coach", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: p.title, start: start.toISOString(), minutes: p.minutes, todoId: p.todoId, prepFor: p.prepFor, ...opts }),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error ?? "Couldn't book it.");
  return data?.clash ?? null;
}

const chip = "rounded-full border border-line px-2.5 py-1 text-xs hover:border-ink/40 disabled:opacity-50";

// Pick your own time for a suggestion, today: free times where it fits (one tap), or any time on the wheel. A
// picked time that overlaps something asks before booking. A time that has passed is refused by the server.
function PickTime({ pick, free, onBooked }: { pick: Pick; free: DayPlan["free"]; onBooked: (start: Date, minutes: number) => void }) {
  const minutes = pick.need ?? pick.minutes;
  const choices = startChoices(free, minutes);
  const [other, setOther] = useState(!choices.length);
  const [clock, setClock] = useState(() => `${String((new Date().getHours() + 1) % 24).padStart(2, "0")}:00`);
  const [clash, setClash] = useState<{ start: Date; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(start: Date, force = false) {
    setBusy(true);
    setError(null);
    try {
      const overlap = await book({ ...pick, minutes }, start, { check: true, force });
      if (overlap) setClash({ start, text: overlap });
      else onBooked(start, minutes);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const atClock = () => {
    const [h, m] = clock.split(":").map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  };

  return (
    <div className="mt-2 rounded-xl border border-line p-2.5 text-sm lg:text-xs">
      {clash ? (
        <>
          <p>
            {time(clash.start.toISOString())} overlaps {clash.text}. Book it anyway?
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" disabled={busy} onClick={() => go(clash.start, true)} className="rounded-full bg-ink px-3 py-1 text-xs font-medium text-paper disabled:opacity-50">
              {busy ? "Booking…" : "Book anyway"}
            </button>
            <button type="button" onClick={() => setClash(null)} className={chip}>
              Pick another time
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-muted">{choices.length ? `Book ${length(minutes)} at:` : `No free stretch of ${length(minutes)} left today. Pick a time:`}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {choices.map((d) => (
              <button key={+d} type="button" disabled={busy} onClick={() => go(d)} className={chip}>
                {time(d.toISOString())}
              </button>
            ))}
            {choices.length > 0 && (
              <button type="button" aria-expanded={other} onClick={() => setOther(!other)} className={chip}>
                Other time…
              </button>
            )}
          </div>
          {other && (
            <div className="mt-2 flex items-center gap-2">
              <TimeWheel aria-label="Start time" value={clock} onChange={setClock} className="rounded-full border border-line px-3 py-1 text-sm" />
              <button type="button" disabled={busy} onClick={() => go(atClock())} className="rounded-full bg-ink px-3 py-1 text-xs font-medium text-paper disabled:opacity-50">
                {busy ? "Booking…" : "Book"}
              </button>
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-accent">
          {error}
        </p>
      )}
    </div>
  );
}

// at: the button it was opened from. Then it hangs just under that button like a chat bubble, its tail pointing
// up at it, instead of in the middle of the screen.
// shortcut: placed once when opened, not moved if the window is resized while it's open.
// No title: no title bar either (the content brings its own heading); label names it for screen readers.
export function Modal({ title, label, onClose, children, at, width: max = 360 }: { title?: string; label?: string; onClose: () => void; children: ReactNode; at?: DOMRect | null; width?: number }) {
  const ref = useDialog<HTMLDivElement>(onClose);
  const box = (
    <>
      {title && (
        // A bubble under a header button is compact; the pop-up in the middle of the screen keeps its roomier size.
        <header className={`flex items-center justify-between border-b border-line ${at ? "px-4 py-2.5" : "px-5 py-3.5"}`}>
          <h2 id="coach-title" className={`font-serif ${at ? "text-xl" : "text-2xl"}`}>
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-full text-muted hover:bg-ink/5 hover:text-ink">
            ✕
          </button>
        </header>
      )}
      <div className={`overflow-y-auto ${at ? "px-4 py-3" : "px-5 py-4"}`}>{children}</div>
    </>
  );
  const named = title ? { "aria-labelledby": "coach-title" } : { "aria-label": label };
  if (at) {
    const vw = window.innerWidth;
    const mid = at.left + at.width / 2;
    const width = Math.min(max, vw - 32); // 16px from each edge
    // The tail sits ~48px in from the bubble's right edge, unless the bubble has to slide over to stay on screen.
    const left = Math.min(Math.max(16, mid + 48 - width), vw - 16 - width);
    const top = at.bottom + 12;
    const tail = mid - left; // from the bubble's left edge to under the button's middle
    return (
      <>
        <motion.div className="fixed inset-0 z-40" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
        <motion.div
          ref={ref}
          role="dialog"
          aria-modal="true"
          {...named}
          initial={{ scale: 0.9, opacity: 0, y: -6 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: -4 }}
          transition={{ type: "spring", damping: 26, stiffness: 340 }}
          style={{ top, left, width, transformOrigin: `${tail}px 0` }}
          className="fixed z-50"
        >
          <span
            aria-hidden
            style={{ left: tail - 10 }}
            className="absolute -top-2.5 z-10 size-5 rotate-45 rounded-tl-[5px] border-l border-t border-line bg-surface"
          />
          <div className="flex flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl" style={{ maxHeight: `calc(100dvh - ${top + 16}px)` }}>
            {box}
          </div>
        </motion.div>
      </>
    );
  }
  return (
    <>
      <motion.div className="fixed inset-0 z-40 bg-ink/25 backdrop-blur-[2px]" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4">
        <motion.div
          ref={ref}
          role="dialog"
          aria-modal="true"
          {...named}
          initial={{ scale: 0.95, opacity: 0, y: 12 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.97, opacity: 0, y: 8 }}
          transition={{ type: "spring", damping: 26, stiffness: 340 }}
          className="pointer-events-auto flex max-h-[min(44rem,calc(100dvh-2rem))] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl"
        >
          {box}
        </motion.div>
      </div>
    </>
  );
}

// "What should I do now?": one answer, with the next best one behind "Something else".
export function WhatNow({ onClose, onCalendarChange }: { onClose: () => void; onCalendarChange: () => void }) {
  return (
    <Modal title="What now?" onClose={onClose}>
      <WhatNowBody onCalendarChange={onCalendarChange} />
    </Modal>
  );
}

// The same, without the pop-up around it (the phone's "What now?" tab).
// onPick hears which task it is suggesting, so the day's plan shown with it can leave that one out.
// lg: sizes are for wide screens, where it (and TodayCard) only show in the small Today bubble.
export function WhatNowBody({ onCalendarChange, onPick }: { onCalendarChange: () => void; onPick?: (title: string | null) => void }) {
  const [answer, setAnswer] = useState<NowAnswer | null>(null);
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<string | null>(null);
  const [free, setFree] = useState<DayPlan["free"]>([]);
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    load<{ now: NowAnswer; today: DayPlan }>("/api/coach").then((d) => (setAnswer(d.now), setFree(d.today.free)), (e: Error) => setError(e.message));
  }, []);

  const pick = answer?.picks[i];
  useEffect(() => onPick?.(pick?.title ?? null), [pick, onPick]);
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
    <>
      {!answer && !error && <p className="text-sm text-muted">Looking at your day…</p>}
      {answer && (
        <div aria-live="polite">
          {pick ? (
            <>
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent">{i === 0 ? "Do this now" : `Or this (${i + 1} of ${answer.picks.length})`}</p>
              <p className="mt-1 break-words font-serif text-3xl leading-tight lg:text-xl">{pick.title}</p>
              <p className="mt-2 text-sm text-muted lg:mt-1 lg:text-xs">{pick.why}</p>
            </>
          ) : (
            <p className="break-words font-serif text-2xl leading-snug lg:text-lg">{answer.headline}</p>
          )}
          <p className="mt-3 text-sm lg:mt-1.5 lg:text-xs">{answer.detail}</p>
          {booked ? (
            <p className="mt-4 rounded-xl bg-ink/5 px-3 py-2 text-sm">{booked}</p>
          ) : (
            pick && (
              <div className="mt-5 flex flex-wrap gap-2 lg:mt-3">
                <button type="button" data-autofocus disabled={busy || pick.minutes < 5} onClick={blockIt} className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50 lg:px-3 lg:py-1.5 lg:text-xs">
                  {busy ? "Booking…" : `Block ${length(pick.minutes)} for it now`}
                </button>
                <button type="button" aria-expanded={choosing} onClick={() => setChoosing(!choosing)} className="rounded-full border border-line px-4 py-2 text-sm hover:border-ink/40 lg:px-3 lg:py-1.5 lg:text-xs">
                  Pick a time
                </button>
                {answer.picks.length > 1 && (
                  <button type="button" onClick={() => (setI((i + 1) % answer.picks.length), setChoosing(false))} className="rounded-full border border-line px-4 py-2 text-sm hover:border-ink/40 lg:px-3 lg:py-1.5 lg:text-xs">
                    Something else
                  </button>
                )}
              </div>
            )
          )}
          {pick && choosing && !booked && (
            <PickTime
              key={i}
              pick={pick}
              free={free}
              onBooked={(start, minutes) => {
                setBooked(`Booked “${pick.title}” at ${time(start.toISOString())}, until ${time(new Date(+start + minutes * 60_000).toISOString())}.`);
                onCalendarChange();
              }}
            />
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-accent">
          {error}
        </p>
      )}
    </>
  );
}

// Today at a glance, above Priorities: events, free time, and the most important work for each free stretch.
// inDialog: inside the header Today button's bubble, which has its own title, so no card or heading.
// skip: the task What now? is already suggesting above it, so it isn't offered twice.
export function TodayCard({ version, onCalendarChange, waiting, inDialog, skip }: { version: number; onCalendarChange: () => void; waiting?: boolean; inDialog?: boolean; skip?: string | null }) {
  const [plan, setPlan] = useState<DayPlan | null>(null);
  const [risks, setRisks] = useState<PrepState[]>([]);
  const [hidden, setHidden] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(RISK_NOT_NOW) ?? "{}")[todayKey()] ?? [];
    } catch {
      return [];
    }
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null); // the suggestion (by its start) whose time is being picked

  useEffect(() => {
    load<{ today: DayPlan; risks?: PrepState[] }>("/api/coach").then((d) => (setPlan(d.today), setRisks(d.risks ?? []), setChoosing(null)), () => {});
  }, [version]);

  // A warning's buttons: book prep into the free time left, mark the deadline done, or hide it until tomorrow.
  async function riskAction(r: PrepState, action: "fit" | "done" | "later") {
    if (action === "later") {
      const next = [...hidden, r.key];
      setHidden(next);
      try {
        localStorage.setItem(RISK_NOT_NOW, JSON.stringify({ [todayKey()]: next }));
      } catch {}
      return;
    }
    setBusy(r.key);
    setError(null);
    try {
      // Priorities keys are "<calendarId>:<eventId>"; Google event ids never contain ":".
      const cut = r.key.lastIndexOf(":");
      const res =
        action === "fit"
          ? await fetch("/api/coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fit: r.key }) })
          : await fetch("/api/priorities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ calendarId: r.key.slice(0, cut), eventId: r.key.slice(cut + 1), action: "done" }) });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Couldn't do that. Try again.");
      onCalendarChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

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

  if (!plan) return waiting ? <p className="text-sm text-muted">Looking at your day…</p> : null;
  return (
    <section aria-labelledby={inDialog ? undefined : "today-title"} className={inDialog ? "" : "rounded-2xl border border-line bg-surface p-4"}>
      {!inDialog && (
        <h2 id="today-title" className="font-serif text-xl">
          Today
        </h2>
      )}
      <p className="mt-0.5 text-sm text-muted lg:text-xs">
        {plan.count ? `${plan.count} event${plan.count === 1 ? "" : "s"}` : "No events"}
        {plan.first && ` · first “${plan.first.title}” at ${time(plan.first.start)}`}
        {plan.last && plan.count > 1 && ` · done by ${time(plan.last.end)}`}
        {` · ${hours(plan.freeMinutes)} free`}
      </p>
      {risks
        .filter((r) => !hidden.includes(r.key))
        .map((r) => (
          <div key={r.key} role="status" className="mt-3 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-sm lg:text-xs">
            <p className="break-words font-medium">{r.level === "risk" ? `⚠ “${r.title}” is at risk` : `Heads-up: “${r.title}” is tight`}</p>
            <p className="mt-0.5 text-muted">
              {length(r.left)} of prep left, {length(r.free)} free before {dayTime(r.due)}.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button type="button" disabled={!!busy || r.free < 15} onClick={() => riskAction(r, "fit")} className="rounded-full bg-ink px-3 py-1 text-xs font-medium text-paper disabled:opacity-50">
                {busy === r.key ? "Booking…" : "Book what fits"}
              </button>
              <button type="button" disabled={!!busy} onClick={() => riskAction(r, "done")} className="rounded-full border border-line px-3 py-1 text-xs hover:border-ink/40 disabled:opacity-50">
                Mark done
              </button>
              <button type="button" onClick={() => riskAction(r, "later")} className="rounded-full px-2 py-1 text-xs text-muted hover:text-ink">
                Not now
              </button>
            </div>
          </div>
        ))}
      {plan.blocks.some((b) => b.title !== skip) && (
        <ul className="mt-3 space-y-2">
          {plan.blocks.filter((b) => b.title !== skip).map((b) => (
            <li key={b.start} className="text-sm lg:text-xs">
              <div className="flex items-start gap-3">
                {/* The suggested time; tap it to pick your own. */}
                <button
                  type="button"
                  aria-expanded={choosing === b.start}
                  aria-label={`${time(b.start)}. Pick another time for “${b.title}”`}
                  onClick={() => setChoosing(choosing === b.start ? null : b.start)}
                  className="w-16 shrink-0 pt-0.5 text-left font-mono text-xs text-muted underline decoration-dotted underline-offset-4 hover:text-ink"
                >
                  {time(b.start)}
                </button>
                <span className="min-w-0 flex-1">
                  <span className="block break-words leading-snug">{b.title}</span>
                  <span className="block text-xs text-muted">
                    {length(b.minutes)} · {b.why}
                  </span>
                </span>
                <button type="button" disabled={!!busy} onClick={() => bookBlock(b)} className="shrink-0 rounded-full border border-line px-2.5 py-0.5 text-xs hover:border-ink/40 disabled:opacity-50">
                  {busy === b.start ? "Booking…" : "Book"}
                </button>
              </div>
              {choosing === b.start && <PickTime pick={b} free={plan.free} onBooked={onCalendarChange} />}
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
          {r.note && <p className="mt-3 rounded-xl bg-ink/5 px-3 py-2 text-sm leading-snug">{r.note}</p>}

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
