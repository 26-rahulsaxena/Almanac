"use client";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { Priority } from "@/lib/priorities";
import { latestSafe, laterOptions, SEVERITIES, type Severity } from "@/lib/priority";

export const SEVERITY_LABEL: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
export const sevColor = (s: Severity) => `var(--sev-${s})`;

export type PriorityAction =
  | { action: "severity"; severity: Severity | null }
  | { action: "deadline"; deadline: boolean | null }
  | { action: "doing"; minutes: number }
  | { action: "later"; until: string }
  | { action: "done" | "stuck" | "open" };

type Props = {
  items: Priority[] | null;
  onAction: (p: Priority, a: PriorityAction) => Promise<void>;
};

const ease = [0.22, 1, 0.36, 1] as const;
const clock = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
// "today", "tomorrow", else "Wed, 11 Nov".
function day(d: Date, now: Date) {
  const n = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000);
  return n === 0 ? "today" : n === 1 ? "tomorrow" : d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}
const time =(iso: string | Date) => new Date(iso).toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit" });

export function SeverityChip({ severity }: { severity: Severity }) {
  const c = sevColor(severity);
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: `color-mix(in srgb, ${c} 18%, transparent)` }}>
      <span className="size-2 rounded-full" style={{ background: c }} aria-hidden />
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

// "Your priorities", always beside the calendar: the next 5 days, most urgent first, with Doing / Later / Done.
export function PrioritiesPanel({ items, onAction }: Props) {
  const [showLow, setShowLow] = useState(false);
  const open = items?.filter((p) => p.status !== "done") ?? [];
  // Low-priority items (gym, a walk…) fold away so the list stays about what matters.
  const quiet = (p: Priority) => p.severity === "low" && p.status === "open";
  const lowCount = items?.filter(quiet).length ?? 0;
  const shown = items?.filter((p) => showLow || !quiet(p));

  return (
    <section
      id="priorities"
      aria-labelledby="pri-title"
      tabIndex={-1}
      className="flex flex-col rounded-2xl border border-line bg-surface focus:outline-none lg:min-h-[18rem] lg:flex-1"
    >
        <div className="border-b border-line px-4 pb-3 pt-4">
          <div>
            <h2 id="pri-title" className="font-serif text-xl">
              Your priorities
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              {items === null
                ? "Reading your calendar…"
                : open.length
                  ? `${open.length} in the next 5 days`
                  : "Nothing coming up in the next 5 days."}
            </p>
          </div>
        </div>

        <ol className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <AnimatePresence initial={false}>
            {shown?.map((p, i) => (
              <motion.li
                key={p.key}
                layout
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: p.status === "done" ? 0.55 : 1, y: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.35, delay: Math.min(i * 0.05, 0.3), ease }}
              >
                <Card p={p} onAction={(a) => onAction(p, a)} />
              </motion.li>
            ))}
          </AnimatePresence>
          {lowCount > 0 && (
            <li>
              <button type="button" onClick={() => setShowLow(!showLow)} aria-expanded={showLow} className="w-full rounded-2xl border border-dashed border-line py-2 text-xs text-muted hover:text-ink">
                {showLow ? "Hide low-priority items" : `Show ${lowCount} low-priority item${lowCount === 1 ? "" : "s"}`}
              </button>
            </li>
          )}
        </ol>
    </section>
  );
}

function Card({ p, onAction }: { p: Priority; onAction: (a: PriorityAction) => Promise<void> }) {
  const [mode, setMode] = useState<"doing" | "later" | "done" | null>(null);
  const [picking, setPicking] = useState(false); // the four severity choices, opened from the chip
  const [more, setMore] = useState(false); // the ⋮ menu: I'm stuck, Hide
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = sevColor(p.severity);
  const now = new Date();
  const due = new Date(p.due);
  const later = laterOptions(now, due);

  async function act(a: PriorityAction) {
    setBusy(true);
    setError(null);
    try {
      await onAction(a);
      setMode(null);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  const status =
    p.status === "doing" && p.nextCheck
      ? `Doing it · check-in ${time(p.nextCheck)}`
      : p.status === "later" && p.nextCheck
        ? `Later${p.laterCount > 1 ? ` (×${p.laterCount})` : ""} · reminding you ${time(p.nextCheck)}`
        : p.status === "stuck"
          ? "Stuck · checking in again within the hour"
          : p.status === "done"
            ? "Done ✓"
            : null;

  // The reason always ends in " · in <time left>": that part goes in the corner, the rest under the title.
  const cut = p.reason.lastIndexOf(" · in ");
  const why = cut >= 0 ? p.reason.slice(0, cut) : p.reason;
  const left = cut >= 0 ? p.reason.slice(cut + 3) : null;
  const soon = +due - +now < 3 * 3_600_000;
  // "Deadline: submit…" → "Submit…": the chip and "Due" already say it's a deadline.
  const title = p.title.replace(/^(deadline|due)\s*[:–-]\s*/i, "").replace(/^./, (ch) => ch.toUpperCase());

  const btn = "rounded-full px-2.5 py-1 text-xs transition-colors disabled:opacity-50";
  // Tighter when the card is narrow (the side panel on a computer), so the three always fit.
  const big = "whitespace-nowrap rounded-full px-2 py-1.5 text-center text-[11px] @[15rem]:px-3 @[15rem]:text-xs transition-colors disabled:opacity-50";
  return (
    // The whole card takes its severity's colour: red, orange, yellow or green.
    <div className="relative rounded-2xl border" style={{ background: `color-mix(in srgb, ${c} 16%, var(--paper))`, borderColor: `color-mix(in srgb, ${c} 45%, transparent)` }}>
      <div className="@container px-4 py-3.5">
        <div className="flex items-center justify-between gap-2">
          {/* Tap the level to change it; the four choices stay out of the way until then. */}
          <button
            type="button"
            disabled={busy || p.status === "done"}
            onClick={() => setPicking(!picking)}
            aria-expanded={picking}
            aria-label={`Severity: ${SEVERITY_LABEL[p.severity]}. Change`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: `color-mix(in srgb, ${c} 18%, transparent)` }}
          >
            <span className="size-2 rounded-full" style={{ background: c }} aria-hidden />
            {SEVERITY_LABEL[p.severity]}
            {!p.chosen && p.suggested === p.severity && <span className="font-normal opacity-70">· {p.ai ? "AI" : "suggested"}</span>}
            {p.status !== "done" && (
              <svg className={`size-3 transition-transform ${picking ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                <path d="m6 9 6 6 6-6" />
              </svg>
            )}
          </button>
          <div className="flex shrink-0 items-center gap-1">
            {left && p.status !== "done" && (
              <span className="text-xs font-medium" style={{ color: soon ? "var(--sev-critical)" : "var(--muted)" }}>
                {left}
              </span>
            )}
            {/* The rarer actions, out of the way until asked for. */}
            {p.status !== "done" && (
              <div className="relative -mr-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setMore(!more)}
                  aria-haspopup="menu"
                  aria-expanded={more}
                  aria-label={`More for ${title}`}
                  className="grid size-7 place-items-center rounded-full text-muted hover:bg-ink/10 hover:text-ink"
                >
                  <svg className="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <circle cx="12" cy="5" r="1.8" />
                    <circle cx="12" cy="12" r="1.8" />
                    <circle cx="12" cy="19" r="1.8" />
                  </svg>
                </button>
                <AnimatePresence>
                  {more && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMore(false)} aria-hidden />
                      <motion.div
                        role="menu"
                        initial={{ opacity: 0, scale: 0.95, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -4 }}
                        transition={{ duration: 0.15, ease }}
                        onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setMore(false))}
                        className="absolute right-0 top-full z-20 mt-1 w-44 origin-top-right rounded-xl border border-line bg-surface p-1 shadow-lg"
                      >
                        {p.status !== "stuck" && (
                          <button type="button" role="menuitem" autoFocus onClick={() => (setMore(false), act({ action: "stuck" }))} className="block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-ink/5">
                            I&apos;m stuck
                          </button>
                        )}
                        <button type="button" role="menuitem" autoFocus={p.status === "stuck"} onClick={() => (setMore(false), act({ action: "deadline", deadline: false }))} className="block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-ink/5">
                          Hide
                        </button>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
        <h3 className={`mt-2.5 text-sm font-medium leading-snug ${p.status === "done" ? "line-through" : ""}`}>{title}</h3>
        <p className="mt-1.5 text-xs text-muted">
          {p.category === "deadline" ? "Due" : "Starts"} {p.allDay ? `${day(due, now)}, all day` : `${day(due, now)}, ${clock(due)}`}
        </p>
        {why && <p className="mt-0.5 text-xs text-muted/80">{why}</p>}
        {status && (
          <p className="mt-1 text-xs font-medium" style={{ color: p.status === "stuck" ? "var(--sev-critical)" : undefined }}>
            {status}
          </p>
        )}

        {p.status === "done" ? (
          <button type="button" disabled={busy} onClick={() => act({ action: "open" })} className={`${btn} mt-2 text-muted underline hover:text-ink`}>
            Undo
          </button>
        ) : (
          <>
            {picking && (
              <div className="@container mt-3">
                {/* One bar of four equal parts, so it never wraps; who suggested what goes on the line below. The dots
                    go when the bar is too narrow for them (the narrow side panel on a computer). */}
                <div role="radiogroup" aria-label={`Severity of ${p.title}`} className="grid grid-cols-4 rounded-full border border-line p-0.5">
                  {[...SEVERITIES].reverse().map((s) => {
                    const on = p.severity === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        disabled={busy}
                        onClick={() => act({ action: "severity", severity: s }).then(() => setPicking(false))}
                        className={`flex min-w-0 items-center justify-center gap-1 rounded-full py-1.5 text-[11px] ${on ? "font-semibold" : "text-muted hover:text-ink"}`}
                        style={on ? { background: `color-mix(in srgb, ${sevColor(s)} 22%, transparent)`, boxShadow: `inset 0 0 0 1.5px ${sevColor(s)}` } : undefined}
                      >
                        <span className="hidden size-1.5 shrink-0 rounded-full @[16rem]:block" style={{ background: sevColor(s) }} aria-hidden />
                        {SEVERITY_LABEL[s]}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-center text-[11px] text-muted">
                  {p.ai ? "AI" : "Almanac"} suggested {SEVERITY_LABEL[p.suggested]}
                  {p.chosen && (
                    <>
                      {" · "}
                      <button type="button" disabled={busy} onClick={() => act({ action: "severity", severity: null }).then(() => setPicking(false))} className="underline hover:text-ink">
                        Use suggestion
                      </button>
                    </>
                  )}
                </p>
              </div>
            )}

            {/* Three equal buttons that always fit on one line; the rarer actions are in the ⋮ menu at the top. */}
            <div className="mt-4 grid grid-cols-[auto_1fr_1fr] gap-2">
              <button type="button" disabled={busy} onClick={() => setMode(mode === "doing" ? null : "doing")} aria-expanded={mode === "doing"} className={`${big} bg-ink font-medium text-paper`}>
                Doing it now
              </button>
              <button type="button" disabled={busy} onClick={() => setMode(mode === "later" ? null : "later")} aria-expanded={mode === "later"} className={`${big} border border-line bg-surface hover:border-ink/40`}>
                Later
              </button>
              <button type="button" disabled={busy} onClick={() => setMode(mode === "done" ? null : "done")} aria-expanded={mode === "done"} className={`${big} border border-line bg-surface hover:border-ink/40`}>
                Done
              </button>
            </div>

            <AnimatePresence initial={false}>
              {mode && (
                <motion.div
                  key={mode}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease }}
                  className="overflow-hidden"
                >
                  <div className="mt-3 rounded-xl bg-ink/[0.04] p-3 text-xs">
                    {mode === "doing" && (
                      <>
                        <p>How long will it take? I&apos;ll check back then.</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {[
                            [5, "5 min"],
                            [10, "10 min"],
                            [15, "15 min"],
                            [30, "30 min"],
                            [60, "1 hour"],
                            [120, "2 hours"],
                            [180, "3 hours"],
                          ].map(([m, l]) => (
                            <button key={m} type="button" disabled={busy} onClick={() => act({ action: "doing", minutes: m as number })} className={`${btn} border border-line bg-surface hover:border-ink/40`}>
                              {l}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    {mode === "later" &&
                      (later.length ? (
                        <>
                          <p>
                            When should I remind you? Latest safe start: <strong>{time(latestSafe(due))}</strong>.
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {later.map((o) => (
                              <button key={o.label} type="button" disabled={busy} onClick={() => act({ action: "later", until: o.at.toISOString() })} className={`${btn} border border-line bg-surface hover:border-ink/40`}>
                                {o.label}
                              </button>
                            ))}
                          </div>
                          {p.laterCount >= 1 && <p className="mt-2 text-xs text-muted">Putting it off again raises its severity.</p>}
                        </>
                      ) : (
                        <p style={{ color: "var(--sev-critical)" }}>Too close to the deadline to put off. Start now.</p>
                      ))}
                    {mode === "done" && (
                      <>
                        <p>Is it actually finished or submitted?</p>
                        <div className="mt-2 flex gap-1.5">
                          <button type="button" disabled={busy} onClick={() => act({ action: "done" })} className={`${btn} bg-ink font-medium text-paper`}>
                            Yes, it&apos;s done
                          </button>
                          <button type="button" onClick={() => setMode(null)} className={`${btn} border border-line bg-surface`}>
                            Not yet
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
        {error && (
          <p role="alert" className="mt-2 text-xs" style={{ color: "var(--sev-critical)" }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
