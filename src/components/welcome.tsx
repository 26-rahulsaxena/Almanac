"use client";
import { motion } from "motion/react";
import { useState } from "react";
import { saveProfile } from "@/app/actions";
import { FOCUS, isRole, ROLES, type Profile } from "@/lib/profile";
import { Modal } from "./coach";
import { enablePush, PUSH_HELP, usePushState } from "./notify-settings";
import { HowItWorks } from "./tour";

// The first time it's kept short: how it works, your role, what matters most (already picked for the role),
// reminders on this device. From Settings it's "About you": role, title, what matters most, anything else.
const FIRST = ["how", "role", "focus", "alerts"] as const;
const EDIT = ["role", "title", "focus", "note"] as const;

// Shown once after the first sign-in (skipping counts as answered) and again from Settings to edit.
export function Welcome({ initial, first, onDone }: { initial: Profile; first: boolean; onDone: (p: Profile) => void }) {
  const [p, setP] = useState(initial);
  const [step, setStep] = useState(0);
  const steps: readonly string[] = first ? FIRST : EDIT;
  const at = steps[step];
  const next = () => setStep((s) => Math.min(s + 1, steps.length - 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish(skip: boolean) {
    setBusy(true);
    setError(null);
    try {
      onDone(await saveProfile(skip ? null : p));
    } catch {
      setError("Couldn't save. Try again.");
      setBusy(false);
    }
  }
  // Closing the first-time pop-up counts as "Skip for now" (on the reminders step the answers are already given, so
  // they're saved); closing an edit keeps what was saved.
  const close = () => (first ? finish(at !== "alerts") : onDone(initial));

  // "Other": they type their own role, so it waits for Next instead of moving on.
  const [other, setOther] = useState(!!initial.role && !isRole(initial.role));

  function pickRole(role: string) {
    // A new role brings its usual priorities; the same role keeps what was picked.
    setOther(false);
    setP((x) => (x.role === role ? x : { ...x, role, focus: [...(ROLES.find(([r]) => r === role)?.[1] ?? [])] }));
    next();
  }
  function pickOther() {
    setOther(true);
    setP((x) => (isRole(x.role) ? { ...x, role: "", focus: [] } : x));
  }
  const toggle = (f: string) => setP((x) => ({ ...x, focus: x.focus.includes(f) ? x.focus.filter((y) => y !== f) : [...x.focus, f] }));

  const chip = (on: boolean) =>
    `rounded-full border px-3 py-1.5 text-sm transition ${on ? "border-ink bg-ink text-surface" : "border-line hover:border-ink/40"}`;
  const input = "mt-3 w-full rounded-xl border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-ink/40";
  const last = step === steps.length - 1;

  return (
    <Modal title={first ? "Welcome to Almanac" : "About you"} onClose={close}>
      <p className="text-sm text-muted">
        Step {step + 1} of {steps.length}
      </p>
      <div className="mt-2 flex gap-1" aria-hidden>
        {steps.map((_, i) => (
          <span key={i} className={`h-1 flex-1 rounded-full ${i <= step ? "bg-ink" : "bg-ink/10"}`} />
        ))}
      </div>

      <motion.div key={step} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.15 }} className="mt-5 min-h-[13rem]">
        {at === "how" && (
          <>
            <p className="mb-4 font-serif text-xl">How it works</p>
            <HowItWorks />
          </>
        )}
        {at === "role" && (
          <fieldset>
            <legend className="font-serif text-xl">What best describes you?</legend>
            {first && <p className="mt-1 text-sm text-muted">So Almanac knows what matters in your work.</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {ROLES.map(([r]) => (
                <button key={r} type="button" aria-pressed={p.role === r} onClick={() => pickRole(r)} className={chip(p.role === r)}>
                  {r}
                </button>
              ))}
              <button type="button" aria-pressed={other} onClick={pickOther} className={chip(other)}>
                Other
              </button>
            </div>
            {other && (
              <input
                autoFocus
                aria-label="Your role"
                value={p.role}
                maxLength={60}
                onChange={(e) => setP({ ...p, role: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && next()}
                placeholder="Type your role, e.g. Librarian"
                className={input}
              />
            )}
          </fieldset>
        )}
        {at === "title" && (
          <label className="block">
            <span className="font-serif text-xl">What&rsquo;s your title?</span>
            <span className="ml-2 text-sm text-muted">optional</span>
            <input autoFocus value={p.title} maxLength={80} onChange={(e) => setP({ ...p, title: e.target.value })} onKeyDown={(e) => e.key === "Enter" && next()} placeholder="Assistant Professor, Marketing" className={input} />
          </label>
        )}
        {at === "focus" && (
          <fieldset>
            <legend className="font-serif text-xl">What matters most to you?</legend>
            <p className="mt-1 text-sm text-muted">{isRole(p.role) ? `Picked for ${p.role.toLowerCase()}. Tap to change.` : "Pick as many as you like."}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {FOCUS.map((f) => (
                <button key={f} type="button" aria-pressed={p.focus.includes(f)} onClick={() => toggle(f)} className={chip(p.focus.includes(f))}>
                  {f}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {at === "note" && (
          <label className="block">
            <span className="font-serif text-xl">Anything else?</span>
            <span className="ml-2 text-sm text-muted">optional</span>
            <textarea autoFocus value={p.note} maxLength={200} rows={3} onChange={(e) => setP({ ...p, note: e.target.value })} placeholder="Committee meetings matter less to me" className={`${input} resize-none`} />
            <span className="mt-1 block text-xs text-muted">The AI reads this when it rates your priorities. Your name and email are never sent.</span>
          </label>
        )}
        {at === "alerts" && (
          <>
            <AlertsStep />
            <p className="mt-6 text-xs text-muted">You can add your title and more in Settings → About you.</p>
          </>
        )}
      </motion.div>

      {error && <p className="mt-2 text-sm text-[var(--cat-1)]">{error}</p>}
      <div className="mt-4 flex items-center gap-2">
        <button type="button" disabled={busy} onClick={close} className="rounded-full px-3 py-1.5 text-sm text-muted hover:text-ink">
          Skip for now
        </button>
        <span className="flex-1" />
        {step > 0 && (
          <button type="button" disabled={busy} onClick={() => setStep(step - 1)} className="rounded-full border border-line px-4 py-1.5 text-sm hover:border-ink/40">
            Back
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => (last ? finish(false) : setStep(step + 1))}
          className="rounded-full bg-ink px-4 py-1.5 text-sm text-surface hover:bg-ink/85 disabled:opacity-60"
        >
          {last ? (busy ? "Saving…" : first ? "Done" : "Save") : at === "how" ? "Get started" : "Next"}
        </button>
      </div>
    </Modal>
  );
}

// Last step the first time: switch on reminders for this device, so they arrive when Almanac is closed.
function AlertsStep() {
  const state = usePushState();
  const [error, setError] = useState(false);
  return (
    <div>
      <p className="font-serif text-xl">Get reminders on this device</p>
      <p className="mt-1 text-sm text-muted">So reminders and alarms reach you even when Almanac is closed. Do the same on your phone.</p>
      <div className="mt-4">
        {state === "on" && (
          <p className="flex items-center gap-2 text-sm">
            <span className="size-2 rounded-full bg-[var(--cat-2)]" aria-hidden /> Reminders are on for this device
          </p>
        )}
        {state === "off" && (
          <button type="button" onClick={() => enablePush().catch(() => setError(true))} className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper">
            Turn on reminders
          </button>
        )}
        {state && state !== "on" && state !== "off" && <p className="text-sm">{PUSH_HELP[state]}</p>}
        {error && <p className="mt-2 text-sm text-muted">Couldn&rsquo;t switch them on here. Try again, or use Chrome or Edge.</p>}
      </div>
    </div>
  );
}
