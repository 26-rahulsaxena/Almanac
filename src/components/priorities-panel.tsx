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
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const time = (iso: string | Date) => new Date(iso).toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit" });

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
                  ? `${open.length} thing${open.length === 1 ? "" : "s"} in the next 5 days, most important first`
                  : "Nothing coming up in the next 5 days."}
            </p>
          </div>
        </div>

        <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
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
        <p className="border-t border-line px-4 py-3 text-xs text-muted">
          Ranked by kind of task (deadline › work › personal › leisure) and time left. Pressing Later twice raises it a level. Your choice always wins and applies to every
          event with the same name.
        </p>
    </section>
  );
}

function Card({ p, onAction }: { p: Priority; onAction: (a: PriorityAction) => Promise<void> }) {
  const [mode, setMode] = useState<"doing" | "later" | "done" | null>(null);
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

  const btn = "rounded-full px-2.5 py-1 text-xs transition-colors disabled:opacity-50";
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-paper pl-3" style={{ boxShadow: `inset 4px 0 0 ${c}` }}>
      <div className="p-3 pl-2">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityChip severity={p.severity} />
          <h3 className={`min-w-0 flex-1 text-sm font-medium leading-tight ${p.status === "done" ? "line-through" : ""}`}>{p.title}</h3>
        </div>
        <p className="mt-1 text-xs text-muted">
          {p.category === "deadline" ? "Due" : "Starts"}{" "}
          {p.allDay ? `${new Date(p.due).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })} · all day` : when(p.due)} · {p.reason}
        </p>
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
            <div role="radiogroup" aria-label={`Severity of ${p.title}`} className="mt-3 flex flex-wrap gap-1.5">
              {[...SEVERITIES].reverse().map((s) => {
                const on = p.severity === s;
                return (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={busy}
                    onClick={() => act({ action: "severity", severity: s })}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${on ? "border-transparent font-semibold" : "border-line hover:border-ink/30"}`}
                    style={on ? { background: `color-mix(in srgb, ${sevColor(s)} 22%, transparent)`, boxShadow: `inset 0 0 0 1.5px ${sevColor(s)}` } : undefined}
                  >
                    <span className="size-2 rounded-full" style={{ background: sevColor(s) }} aria-hidden />
                    {SEVERITY_LABEL[s]}
                    {p.suggested === s && <span className="font-normal text-muted">· suggested</span>}
                  </button>
                );
              })}
              {p.chosen && (
                <button type="button" disabled={busy} onClick={() => act({ action: "severity", severity: null })} className="px-1 text-xs text-muted underline">
                  Use suggestion
                </button>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <button type="button" disabled={busy} onClick={() => setMode(mode === "doing" ? null : "doing")} aria-expanded={mode === "doing"} className={`${btn} bg-ink font-medium text-paper`}>
                ▶ Doing it now
              </button>
              <button type="button" disabled={busy} onClick={() => setMode(mode === "later" ? null : "later")} aria-expanded={mode === "later"} className={`${btn} border border-line hover:border-ink/40`}>
                ⏰ Later
              </button>
              <button type="button" disabled={busy} onClick={() => setMode(mode === "done" ? null : "done")} aria-expanded={mode === "done"} className={`${btn} border border-line hover:border-ink/40`}>
                ✓ Done
              </button>
              <span className="flex-1" />
              {p.status !== "stuck" && (
                <button type="button" disabled={busy} onClick={() => act({ action: "stuck" })} className={`${btn} text-muted hover:text-ink`}>
                  I&apos;m stuck
                </button>
              )}
              <button type="button" disabled={busy} onClick={() => act({ action: "deadline", deadline: false })} className={`${btn} text-muted hover:text-ink`}>
                Hide
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
