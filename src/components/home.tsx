"use client";
import { motion } from "motion/react";
import { signOutNow } from "@/app/actions";
import { ThemeToggle } from "./theme-toggle";

const ease = [0.22, 1, 0.36, 1] as const;

// Stage 1 home: proves sign-in and calendar permission work. Stage 2 replaces the card with your calendars.
export function Home({ name, email, calendarAccess }: { name: string; email: string; calendarAccess: boolean }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-8">
        <span className="font-serif text-2xl">Almanac</span>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <form action={signOutNow}>
            <button type="submit" className="rounded-full border border-line px-4 py-2 text-sm hover:border-ink/40">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8">
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease }}
          className="font-serif text-5xl sm:text-7xl"
        >
          Hello, <em className="text-accent">{name.split(" ")[0]}.</em>
        </motion.h1>

        <motion.ul
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.1, delayChildren: 0.2 } } }}
          className="mt-10 max-w-lg divide-y divide-line rounded-2xl border border-line bg-surface"
        >
          <Row ok label="Signed in with Google" detail={email} />
          <Row
            ok={calendarAccess}
            label={calendarAccess ? "Calendar permission granted" : "Calendar permission missing"}
            detail={
              calendarAccess
                ? "Saved securely on the server, encrypted."
                : "Sign out, sign in again, and tick the calendar boxes on Google's screen."
            }
          />
        </motion.ul>
        <p className="mt-6 text-sm text-muted">Next stage: your calendars and events appear here.</p>
      </main>
    </div>
  );
}

function Row({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <motion.li
      variants={{ hidden: { opacity: 0, x: -12 }, show: { opacity: 1, x: 0, transition: { ease } } }}
      className="flex items-start gap-3 px-5 py-4"
    >
      <span
        className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-sm text-paper ${ok ? "bg-[var(--cat-2)]" : "bg-accent"}`}
        aria-hidden
      >
        {ok ? "✓" : "!"}
      </span>
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-sm text-muted">{detail}</p>
      </div>
    </motion.li>
  );
}
