"use client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { setMailOn } from "@/app/actions";
import { almanacPlugin, appOpensGmail, isAndroidApp } from "@/lib/android-app";
import { gmailLink } from "@/lib/mail-parse";
import { GoogleSignIn } from "./google-sign-in";

type Find = { id: string; thread_id: string; kind: "meeting" | "call" | "deadline"; title: string; start_at: string; end_at: string | null; summary: string; quote: string; sender: string };

// The whole email in Gmail: on a computer in a new tab (the link itself), in the Android app in the Gmail app
// (an app from before version 6 can only show it in a browser page).
async function openInGmail(e: React.MouseEvent, url: string) {
  if (!isAndroidApp()) return;
  e.preventDefault();
  if (appOpensGmail()) return (await almanacPlugin()).openGmail({ url });
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url });
}

const when = (f: Find) => {
  const d = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-IN", o);
  const at = d(f.start_at, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return f.end_at ? `${at} – ${d(f.end_at, { hour: "numeric", minute: "2-digit" })}` : `Due ${at}`;
};

// "Found in your email" (Ask-first mode): meetings, calls and deadlines the AI spotted in new mail, each with a few
// words on what's wanted; Show words reveals the email's own words, Open in Gmail the whole email. Nothing goes on
// the calendar until Add. Shows nothing when there's nothing waiting.
export function MailFinds({ email, version, onCalendarChange }: { email: string; version: number; onCalendarChange: () => void }) {
  const [list, setList] = useState<Find[] | null>(null);
  const [shown, setShown] = useState<Set<string>>(new Set()); // cards showing the email's own words
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/mail")
      .then((r) => (r.ok ? r.json() : null))
      .then((l: Find[] | null) => l && setList(l))
      .catch(() => {});
  }, [version]);

  async function answer(id: string, action: "add" | "dismiss") {
    setBusy(id);
    setError(null);
    try {
      const r = await fetch("/api/mail", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action }) });
      const data = await r.json().catch(() => null);
      if (Array.isArray(data)) setList(data);
      else if (data?.list) setList(data.list);
      if (!r.ok) setError(data?.error === "reauth" ? "Google needs you to sign in again." : (data?.error ?? "Couldn't add it. Try again."));
      else if (action === "add") onCalendarChange();
    } finally {
      setBusy(null);
    }
  }

  if (!list?.length) return null;
  return (
    <motion.section aria-labelledby="mail-title" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-accent/50 bg-surface p-4">
      <h2 id="mail-title" className="font-serif text-xl">
        Found in your email
      </h2>
      <p className="text-xs text-muted">Nothing goes on your calendar until you press Add. Nobody is invited.</p>
      <ul className="mt-3 space-y-3">
        <AnimatePresence initial={false}>
          {list.map((f) => {
            const open = shown.has(f.id) || !f.summary; // found before summaries existed: the words are all there is
            const toggle = () => {
              const next = new Set(shown);
              if (!next.delete(f.id)) next.add(f.id);
              setShown(next);
            };
            return (
            <motion.li key={f.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="text-sm">
              <p className="break-words font-medium leading-snug">{f.title}</p>
              <p className="mt-0.5 text-xs text-muted">
                {when(f)} · {f.kind === "deadline" ? "to-do" : f.kind}
              </p>
              {f.summary && <p className="mt-1 break-words leading-snug">{f.summary}</p>}
              <AnimatePresence initial={false}>
                {open && f.quote && (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-1 overflow-hidden break-words border-l-2 border-line pl-2 text-xs italic text-muted"
                  >
                    “{f.quote}” <span className="not-italic">from {f.sender}</span>
                  </motion.p>
                )}
              </AnimatePresence>
              <div className="mt-1 flex gap-3 text-xs">
                {f.summary && f.quote && (
                  <button type="button" aria-expanded={open} onClick={toggle} className="font-medium text-accent hover:underline">
                    {open ? "Hide words" : "Show words"}
                  </button>
                )}
                <a href={gmailLink(email, f.thread_id)} target="_blank" rel="noopener noreferrer" onClick={(e) => openInGmail(e, gmailLink(email, f.thread_id))} className="font-medium text-accent hover:underline">
                  Open in Gmail
                </a>
              </div>
              <div className="mt-2 flex gap-1.5">
                <button type="button" disabled={!!busy} onClick={() => answer(f.id, "add")} className="rounded-full bg-ink px-3 py-1 text-xs font-medium text-paper disabled:opacity-50">
                  {busy === f.id ? "Adding…" : "Add"}
                </button>
                <button type="button" disabled={!!busy} onClick={() => answer(f.id, "dismiss")} className="rounded-full border border-line px-3 py-1 text-xs hover:border-ink/40 disabled:opacity-50">
                  Not now
                </button>
              </div>
            </motion.li>
            );
          })}
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

// Settings → Planning: "Read my email". gmail: Google has allowed reading it; on: switched on.
export function MailSetting({ gmail, on: initial, onChange }: { gmail: boolean; on: boolean; onChange: (on: boolean) => void }) {
  const [on, setOn] = useState(initial);
  const [error, setError] = useState(false);
  const active = gmail && on;
  function turn(next: boolean) {
    setError(false);
    setOn(next);
    setMailOn(next).then(
      () => onChange(next),
      () => {
        setOn(!next);
        setError(true);
      },
    );
  }
  return (
    <div className="mt-3 text-sm">
      <p className="flex items-center gap-2">
        <span className={`size-2 rounded-full ${active ? "bg-[var(--cat-2)]" : "bg-muted"}`} aria-hidden />
        {active ? "On: new emails are read within a minute of arriving" : "Off"}
      </p>
      <p className="mt-2 text-xs text-muted">
        Almanac&rsquo;s AI reads new emails in your Primary inbox and spots meetings, calls and deadlines (&ldquo;call me tomorrow
        at 4&rdquo;, &ldquo;submit this by Friday&rdquo;). With Ask me first, they wait for you to press Add; with Automatic, they go
        straight onto your calendar. It never invites or replies to anyone. Email text goes to the AI service to be read and
        isn&rsquo;t saved; only what&rsquo;s found is kept, for 30 days.
      </p>
      {active ? (
        <button type="button" onClick={() => turn(false)} className="mt-3 rounded-full border border-line px-4 py-2 text-sm hover:border-ink/40">
          Turn off
        </button>
      ) : gmail ? (
        <button type="button" onClick={() => turn(true)} className="mt-3 rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper">
          Turn on
        </button>
      ) : (
        // Google asks to allow Almanac to read Gmail, then comes back here.
        <GoogleSignIn gmail className="mt-3">
          <button type="submit" className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper">
            Connect Gmail
          </button>
        </GoogleSignIn>
      )}
      {error && <p className="mt-2 text-xs text-accent">Couldn&apos;t save. Try again.</p>}
    </div>
  );
}
