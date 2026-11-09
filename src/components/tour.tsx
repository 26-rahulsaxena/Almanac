"use client";
import { motion } from "motion/react";
import { useState } from "react";

const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const CARDS = [
  {
    title: "Never miss what matters",
    text: "Your Google Calendar and your to-dos, together in one place.",
    art: (
      <>
        <rect x="8" y="10" width="48" height="46" rx="11" {...s} />
        <path d="M8 22h48M20 6v8M44 6v8" {...s} />
        <path d="m22 38 6 6 14-14" {...s} strokeWidth={2.4} />
        <circle cx="52" cy="14" r="6" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" />
      </>
    ),
  },
  {
    title: "Just say it",
    text: "Tap Ask Almanac and say “Dentist Friday 4 pm” or “Remind me to pay rent”. It adds it for you.",
    art: (
      <>
        <rect x="24" y="8" width="16" height="30" rx="8" {...s} />
        <path d="M16 30a16 16 0 0 0 32 0M32 46v10M24 56h16" {...s} />
        <path d="M52 18c3 3 3 9 0 12M57 13c6 6 6 16 0 22" {...s} stroke="var(--accent)" />
      </>
    ),
  },
  {
    title: "It tells you what’s next",
    text: "“What now?” picks the one thing to do right now. Priorities shows what’s due soonest, and Almanac fits your to-dos into free time.",
    art: (
      <>
        <rect x="8" y="12" width="48" height="10" rx="5" fill="var(--accent)" />
        <rect x="8" y="28" width="38" height="10" rx="5" {...s} />
        <rect x="8" y="44" width="28" height="10" rx="5" {...s} />
        <path d="M14 17h20" stroke="var(--surface)" strokeWidth="2.4" strokeLinecap="round" />
      </>
    ),
  },
  {
    title: "It won’t let you forget",
    text: "Reminders keep coming, even when the app is closed, until you mark it done. Big things ring full screen, like an alarm.",
    art: (
      <>
        <path d="M20 44V30a12 12 0 0 1 24 0v14l4 5H16Z" {...s} />
        <path d="M28 54a4 4 0 0 0 8 0" {...s} />
        <path d="M10 22c1-6 4-10 8-13M54 22c-1-6-4-10-8-13" {...s} stroke="var(--accent)" />
      </>
    ),
  },
];

// "How it works": four cards, one idea each. Shown before the Welcome questions the first time, and again from
// Settings → General. doneLabel is the last card's button; Skip ends it early.
export function Tour({ doneLabel, onDone }: { doneLabel: string; onDone: () => void }) {
  const [i, setI] = useState(0);
  const c = CARDS[i];
  const last = i === CARDS.length - 1;
  return (
    <div>
      <p className="text-sm text-muted">
        How it works &middot; {i + 1} of {CARDS.length}
      </p>
      <motion.div
        key={i}
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2 }}
        aria-live="polite"
        className="flex min-h-[17rem] flex-col items-center justify-center text-center"
      >
        <div className="grid size-32 place-items-center rounded-full bg-ink/5 text-ink" aria-hidden>
          <svg viewBox="0 0 64 64" className="size-20">
            {c.art}
          </svg>
        </div>
        <h3 className="mt-6 font-serif text-2xl">{c.title}</h3>
        <p className="mt-2 max-w-xs text-sm text-muted">{c.text}</p>
      </motion.div>
      <div className="mt-2 flex justify-center gap-1.5" aria-hidden>
        {CARDS.map((_, n) => (
          <span key={n} className={`h-1.5 rounded-full transition-all ${n === i ? "w-5 bg-ink" : "w-1.5 bg-ink/20"}`} />
        ))}
      </div>
      <div className="mt-5 flex items-center gap-2">
        {!last && (
          <button type="button" onClick={onDone} className="rounded-full px-3 py-1.5 text-sm text-muted hover:text-ink">
            Skip
          </button>
        )}
        <span className="flex-1" />
        {i > 0 && (
          <button type="button" onClick={() => setI(i - 1)} className="rounded-full border border-line px-4 py-2 text-sm hover:border-ink/40">
            Back
          </button>
        )}
        <button type="button" onClick={() => (last ? onDone() : setI(i + 1))} className="rounded-full bg-ink px-5 py-2 text-sm font-medium text-paper hover:bg-ink/85">
          {last ? doneLabel : "Next"}
        </button>
      </div>
    </div>
  );
}
