"use client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { setMailOn } from "@/app/actions";
import type { Account } from "@/lib/accounts";
import { GoogleSignIn, startLink } from "./google-sign-in";
import { TimeWheel } from "./time-wheel";

// account_email: the inbox it was found in, when it isn't the main one. pick_time: the email gave no time.
// sender_email: their address (null on finds from before it was kept; Add reads it from the email then).
type Find = { id: string; thread_id: string; kind: "meeting" | "call" | "deadline"; title: string; start_at: string; end_at: string | null; summary: string; quote: string; sender: string; account_email: string | null; pick_time: boolean; sender_email: string | null };

// A moment as this device's "YYYY-MM-DD" and "HH:MM", for the date and time pickers.
const localParts = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
};

const when = (f: Find) => {
  const d = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-IN", o);
  const at = d(f.start_at, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return f.end_at ? `${at} – ${d(f.end_at, { hour: "numeric", minute: "2-digit" })}` : `Due ${at}`;
};

// "Found in your email" (Ask-first mode): meetings, calls and deadlines the AI spotted in new mail, each with a few
// words on what's wanted; Show words reveals the email's own words. (No Open in Gmail: on phones the link wouldn't
// open the email.) Nothing goes on
// the calendar until Add. Shows nothing when there's nothing waiting. inDialog: inside the header mail button's
// pop-up, which has its own title, so no card or heading; onCount hears how many are waiting.
export function MailFinds({ version, onCalendarChange, inDialog, onCount }: { version: number; onCalendarChange: () => void; inDialog?: boolean; onCount?: (n: number) => void }) {
  const [list, setList] = useState<Find[] | null>(null);
  const [shown, setShown] = useState<Set<string>>(new Set()); // cards showing the email's own words
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The time picked on a card whose email gave none ("YYYY-MM-DD", "HH:MM", in this device's time zone).
  const [picked, setPicked] = useState<Record<string, { date: string; time: string }>>({});
  const [noInvite, setNoInvite] = useState<Set<string>>(new Set()); // meetings and calls with Invite unticked

  useEffect(() => {
    fetch("/api/mail")
      .then((r) => (r.ok ? r.json() : null))
      .then((l: Find[] | null) => l && setList(l))
      .catch(() => {});
  }, [version]);

  useEffect(() => {
    if (list) onCount?.(list.length);
  }, [list, onCount]);

  async function answer(id: string, action: "add" | "dismiss", start?: string, invite?: boolean) {
    setBusy(id);
    setError(null);
    try {
      const r = await fetch("/api/mail", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, start, invite }) });
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
    <motion.section aria-labelledby={inDialog ? undefined : "mail-title"} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className={inDialog ? "" : "rounded-2xl border border-accent/50 bg-surface p-4"}>
      {!inDialog && (
        <h2 id="mail-title" className="font-serif text-xl">
          Found in your email
        </h2>
      )}
      <ul className="mt-3 space-y-3">
        <AnimatePresence initial={false}>
          {list.map((f) => {
            const open = shown.has(f.id) || !f.summary; // found before summaries existed: the words are all there is
            const toggle = () => {
              const next = new Set(shown);
              if (!next.delete(f.id)) next.add(f.id);
              setShown(next);
            };
            // No time in the email: you pick one (it starts at Almanac's suggestion) and the card shows what you picked.
            const choose = f.pick_time && !!f.end_at;
            const pick = picked[f.id] ?? localParts(f.start_at);
            const start = choose ? new Date(`${pick.date}T${pick.time}`) : null;
            const shownTimes = start && f.end_at ? { ...f, start_at: start.toISOString(), end_at: new Date(+start + (+new Date(f.end_at) - +new Date(f.start_at))).toISOString() } : f;
            return (
            <motion.li key={f.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="text-sm">
              <p className="break-words font-medium leading-snug">{f.title}</p>
              <p className="mt-0.5 text-xs text-muted">
                <span className="font-semibold text-ink">{when(shownTimes)}</span> · {f.kind === "deadline" ? "to-do" : f.kind}
                {f.account_email && <span className="break-all"> · in {f.account_email}</span>}
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
              {f.summary && f.quote && (
                <button type="button" aria-expanded={open} onClick={toggle} className="mt-1 text-xs font-medium text-accent hover:underline">
                  {open ? "Hide words" : "Show words"}
                </button>
              )}
              {choose && (
                <div className="mt-2 rounded-xl bg-ink/[0.04] p-2.5">
                  <p className="text-xs text-muted">The email doesn&rsquo;t say when. Pick a time (Almanac suggested a free one):</p>
                  <div className="mt-1.5 grid grid-cols-[1fr_auto] gap-2">
                    <input
                      type="date"
                      aria-label={`Day for ${f.title}`}
                      value={pick.date}
                      min={localParts(new Date().toISOString()).date}
                      onChange={(e) => e.target.value && setPicked({ ...picked, [f.id]: { ...pick, date: e.target.value } })}
                      className="min-w-0 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs"
                    />
                    <TimeWheel aria-label={`Time for ${f.title}`} value={pick.time} onChange={(time) => setPicked({ ...picked, [f.id]: { ...pick, time } })} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-xs" />
                  </div>
                </div>
              )}
              {f.end_at && (
                <label className="mt-2 flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={!noInvite.has(f.id)}
                    onChange={(e) => {
                      const next = new Set(noInvite);
                      if (e.target.checked) next.delete(f.id);
                      else next.add(f.id);
                      setNoInvite(next);
                    }}
                    className="mt-0.5 accent-[var(--accent)]"
                  />
                  <span>
                    Invite {f.sender}: Google emails them the invite{f.sender_email ? ` (${f.sender_email})` : ""}
                  </span>
                </label>
              )}
              <div className="mt-2 flex gap-1.5">
                <button type="button" disabled={!!busy} onClick={() => answer(f.id, "add", start?.toISOString(), !!f.end_at && !noInvite.has(f.id))} className="rounded-full bg-ink px-3 py-1 text-xs font-medium text-paper disabled:opacity-50">
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
// gmail: at least one connected account lets Almanac read its Gmail. With more than one account, each is listed:
// read, or Allow (Google asks for that account's Gmail).
export function MailSetting({ gmail, on: initial, onChange, accounts }: { gmail: boolean; on: boolean; onChange: (on: boolean) => void; accounts: Account[] }) {
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
      {accounts.length > 1 && (
        <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-surface">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1 truncate">{a.email}</span>
              {a.broken ? (
                <span className="shrink-0 text-xs text-accent">Reconnect in Account</span>
              ) : a.gmail ? (
                <span className="shrink-0 text-xs text-muted">{active ? "Read" : "Allowed"}</span>
              ) : a.main ? (
                <GoogleSignIn gmail className="shrink-0">
                  <button type="submit" className="rounded-full border border-line px-3 py-1 text-xs hover:border-ink/40">
                    Allow
                  </button>
                </GoogleSignIn>
              ) : (
                <button type="button" onClick={() => startLink(true).catch(() => setError(true))} className="shrink-0 rounded-full border border-line px-3 py-1 text-xs hover:border-ink/40">
                  Allow
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
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
      {gmail && <OlderMail />}
    </div>
  );
}

// "Read older emails": new here, read the last 30 days once for what's still to come. A page at a time (each call
// reads one page), until the server says there's no more.
function OlderMail() {
  const [state, setState] = useState<{ busy: boolean; pages: number; found: number; done: boolean; error?: string }>({ busy: false, pages: 0, found: 0, done: false });
  async function run() {
    setState({ busy: true, pages: 0, found: 0, done: false });
    let at: object | null = {};
    let found = 0;
    let pages = 0;
    try {
      while (at) {
        const r: Response = await fetch("/api/mail/older", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(at) });
        const j: { found: number; next: object | null; error?: string } = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error === "reauth" || j.error === "gmail" ? "Allow Gmail again above, then try again." : (j.error ?? "Couldn't read your email. Try again."));
        found += j.found;
        pages += 1;
        at = j.next;
        setState({ busy: !!at, pages, found, done: !at });
      }
    } catch (e) {
      setState({ busy: false, pages, found, done: false, error: (e as Error).message });
    }
  }
  const { busy, pages, found, done, error } = state;
  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="font-medium">Read older emails</p>
      <p className="mt-1 text-xs text-muted">
        New here? Read the last 30 days of your Primary inbox once, to find meetings, calls and deadlines that are still to come.
      </p>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="mt-3 rounded-full border border-line px-4 py-2 text-sm hover:border-ink/40 disabled:opacity-60"
      >
        {busy ? `Reading… ${pages * 16} emails so far` : done ? "Read them again" : "Read older emails"}
      </button>
      <p role="status" className="mt-2 text-xs">
        {done && (found ? `Done: found ${found}. With Ask me first they're waiting in Email; with Automatic they're on your calendar.` : "Done: nothing still to come in the last 30 days.")}
        {error && <span className="text-accent">{error}</span>}
      </p>
    </div>
  );
}
