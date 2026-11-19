"use client";
import { useState } from "react";
import { setMailOn } from "@/app/actions";
import type { Account } from "@/lib/accounts";
import { GoogleSignIn, startLink } from "./google-sign-in";

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
    </div>
  );
}
