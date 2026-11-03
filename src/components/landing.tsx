"use client";
import { motion } from "motion/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { signInWithGoogle } from "@/app/actions";
import { ThemeToggle } from "./theme-toggle";

const ease = [0.22, 1, 0.36, 1] as const;

const errors: Record<string, string> = {
  AccessDenied: "Google refused the sign-in. Make sure this Google account is added as a test user in Google Cloud.",
  Configuration: "The app's Google keys or database aren't set up yet. Check the .env.local file.",
  Reauth: "Google needs you to sign in again before it shares your calendar.",
};

// Today's date from the visitor's own clock; the server runs on UTC, which is still yesterday in India until 5:30 am.
const noChanges = () => () => {};
const browserToday = () => new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

export function Landing({ error }: { error?: string }) {
  const today = useSyncExternalStore(noChanges, browserToday, () => "");
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-8">
        <span className="font-serif text-2xl">Almanac</span>
        <ThemeToggle />
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-4 pb-12 sm:px-8 lg:grid-cols-[1.1fr_1fr]">
        <section>
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease }}
            className="font-mono text-xs uppercase tracking-[0.2em] text-muted"
          >
            {today || " "}
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.08, ease }}
            className="mt-4 font-serif text-6xl leading-[0.95] sm:text-8xl"
          >
            Your time,
            <br />
            <em className="text-accent">on one page.</em>
          </motion.h1>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease }}
          >
            <p className="mt-6 max-w-md text-lg text-muted">
              Every Google calendar you have, merged. Free time made obvious. Reminders that refuse to be ignored.
            </p>
            <form action={signInWithGoogle} className="mt-8">
              <motion.button
                type="submit"
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.97 }}
                className="inline-flex items-center gap-3 rounded-full bg-ink px-6 py-3 text-base font-medium text-paper shadow-lg shadow-ink/10"
              >
                <GoogleMark />
                Continue with Google
              </motion.button>
            </form>
            <p className="mt-4 text-sm text-muted">Asks only to manage your calendar and read the Google Sheet you connect. Never your email.</p>
            {error && (
              <p role="alert" className="mt-6 max-w-md rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm">
                {errors[error] ?? `Sign-in failed (${error}). Try again.`}
              </p>
            )}
          </motion.div>
        </section>

        <DayRibbon />
      </main>
    </div>
  );
}

// Decorative preview of the day view: events grow in, free gaps react on hover, a live "now" line.
const START = 8;
const END = 20;
const HOUR = 44; // px per hour
const demo = [
  { from: 9, to: 10.5, title: "Marketing Management", color: "var(--cat-1)" },
  { from: 12, to: 13, title: "Lunch with Aanya", color: "var(--cat-2)" },
  { from: 15, to: 16.5, title: "Case study prep", color: "var(--cat-3)" },
  { from: 18, to: 19, title: "Gym", color: "var(--cat-5)" },
];
const free = [[8, 9], [10.5, 12], [13, 15], [16.5, 18], [19, 20]];
const y = (h: number) => (h - START) * HOUR;
const label = (h: number) =>
  `${Math.floor(h) % 12 || 12}${h % 1 ? `:${String((h % 1) * 60).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;

function DayRibbon() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNow(d.getHours() + d.getMinutes() / 60);
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <motion.div
      aria-hidden
      initial={{ opacity: 0, y: 24, rotate: 1.5 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      transition={{ duration: 0.8, delay: 0.25, ease }}
      className="rounded-3xl border border-line bg-surface p-5 shadow-[0_40px_80px_-48px_rgba(0,0,0,0.45)]"
    >
      <div className="relative ml-12" style={{ height: (END - START) * HOUR }}>
        {Array.from({ length: END - START + 1 }, (_, i) => START + i).map((h) => (
          <div key={h} className="absolute inset-x-0 border-t border-line" style={{ top: y(h) }}>
            <span className="absolute -left-12 -translate-y-1/2 font-mono text-[11px] text-muted">{label(h)}</span>
          </div>
        ))}

        {free.map(([a, b]) => (
          <div
            key={a}
            className="group absolute inset-x-1 rounded-xl border border-dashed border-transparent transition-colors duration-200 hover:border-ink/25 hover:bg-ink/[0.03]"
            style={{ top: y(a) + 3, height: y(b) - y(a) - 6 }}
          >
            <span className="absolute right-3 top-2 translate-y-1 text-xs text-muted opacity-0 transition duration-200 group-hover:translate-y-0 group-hover:opacity-100">
              + Book {label(a).replace(" ", "")}
            </span>
          </div>
        ))}

        {demo.map((e, i) => (
          <motion.div
            key={e.title}
            initial={{ opacity: 0, scaleY: 0.4 }}
            animate={{ opacity: 1, scaleY: 1 }}
            transition={{ duration: 0.5, delay: 0.55 + i * 0.12, ease }}
            className="absolute inset-x-1 origin-top rounded-xl px-3 py-1.5 text-sm"
            style={{
              top: y(e.from) + 2,
              height: y(e.to) - y(e.from) - 4,
              background: `color-mix(in srgb, ${e.color} 16%, transparent)`,
              borderLeft: `3px solid ${e.color}`,
            }}
          >
            <span className="font-medium">{e.title}</span>
          </motion.div>
        ))}

        {now !== null && now >= START && now <= END && (
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.6, delay: 1.1, ease }}
            className="absolute -left-2 right-0 h-0.5 origin-left bg-accent"
            style={{ top: y(now) }}
          >
            <span className="absolute -left-1 -top-[5px] size-3 rounded-full bg-accent" />
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

function GoogleMark() {
  return (
    <svg className="size-5" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
