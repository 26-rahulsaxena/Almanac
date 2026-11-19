"use client";
import { motion } from "motion/react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useDialog } from "./use-dialog";

export type MailAccount = { id: string; email: string; main: boolean; send: boolean };
// A new email, reply or forward. replyTo: the Gmail id of the message answered (the server threads it and fills
// "Re:" in when the subject is left as it was). title: what the sheet is called ("Reply", "New email"…).
export type Draft = { account: string; to: string; cc: string; bcc: string; subject: string; body: string; replyTo?: string; title: string };

// No outline on the fields (the app-wide focus outline sits outside them and the scrolling sheet cut it off); the
// row's bottom line turns the accent colour instead (row).
const field = "min-w-0 flex-1 bg-transparent py-2 text-sm placeholder:text-muted focus:outline-none!";
const row = "flex items-center gap-2 border-b border-line transition-colors focus-within:border-accent";

// The compose sheet: the whole screen on phones, a panel in the corner on wide screens. Plain text only (no
// attachments yet). Sends from the account picked in From: by default the one the conversation came in to.
// Drawn at the top of the page (a portal), so it's above everything else, also inside the full-window Mail.
export function Compose({ draft, accounts, onClose, onSent }: { draft: Draft; accounts: MailAccount[]; onClose: () => void; onSent: (thread: string) => void }) {
  const [d, setD] = useState(draft);
  const [more, setMore] = useState(!!(draft.cc || draft.bcc));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const from = accounts.filter((a) => a.send);
  const changed = d.body.trim() !== draft.body.trim() || d.to !== draft.to;
  const close = () => {
    if (!busy && (!changed || confirm("Discard this email?"))) onClose();
  };
  const ref = useDialog<HTMLDivElement>(close);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });

  async function sendNow() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "send", ...d, title: undefined }) });
      const data = await r.json().catch(() => null);
      if (r.ok) return onSent(data.thread);
      setError(
        data?.error === "allow"
          ? "Almanac may only read this account's mail. Allow it to send (the button at the top of the inbox), then try again."
          : data?.error === "reauth"
            ? "Google needs you to sign in again."
            : (data?.error ?? "Couldn't send. Try again."),
      );
    } catch {
      setError("Couldn't send. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <motion.div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={d.title}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      transition={{ type: "spring", damping: 28, stiffness: 340 }}
      className="fixed inset-0 z-50 flex flex-col bg-surface pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] lg:inset-auto lg:right-6 lg:bottom-6 lg:h-[min(36rem,calc(100dvh-6rem))] lg:w-[34rem] lg:rounded-2xl lg:border lg:border-line lg:shadow-2xl"
    >
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <button type="button" onClick={close} aria-label="Close" className="grid size-9 place-items-center rounded-full text-muted hover:bg-ink/5 hover:text-ink">
          ✕
        </button>
        <h2 className="flex-1 truncate font-serif text-xl">{d.title}</h2>
        <button type="button" disabled={busy} onClick={sendNow} className="rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-paper disabled:opacity-50">
          {busy ? "Sending…" : "Send"}
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4">
        {from.length > 1 && (
          <label className={row}>
            <span className="w-14 shrink-0 text-xs text-muted">From</span>
            <select value={d.account} onChange={set("account")} className={`${field} truncate`}>
              {from.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.email}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={row}>
          <span className="w-14 shrink-0 text-xs text-muted">To</span>
          <input data-autofocus={!d.to || undefined} type="text" inputMode="email" autoComplete="email" value={d.to} onChange={set("to")} className={field} placeholder="name@example.com, …" />
          {!more && (
            <button type="button" onClick={() => setMore(true)} className="shrink-0 text-xs text-muted hover:text-ink">
              Cc · Bcc
            </button>
          )}
        </label>
        {more && (
          <>
            <label className={row}>
              <span className="w-14 shrink-0 text-xs text-muted">Cc</span>
              <input type="text" inputMode="email" value={d.cc} onChange={set("cc")} className={field} />
            </label>
            <label className={row}>
              <span className="w-14 shrink-0 text-xs text-muted">Bcc</span>
              <input type="text" inputMode="email" value={d.bcc} onChange={set("bcc")} className={field} />
            </label>
          </>
        )}
        <label className={row}>
          <span className="w-14 shrink-0 text-xs text-muted">Subject</span>
          <input type="text" value={d.subject} maxLength={300} onChange={set("subject")} className={field} />
        </label>
        <textarea
          data-autofocus={d.to ? true : undefined}
          aria-label="Message"
          value={d.body}
          onChange={set("body")}
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && sendNow()}
          className="min-h-48 flex-1 resize-none bg-transparent py-3 text-sm leading-relaxed focus:outline-none"
          placeholder="Write your email"
          style={{ outline: "none" }} // the sheet itself shows where you're writing
        />
      </div>
      {error && (
        <p role="alert" className="border-t border-line px-4 py-2 text-xs text-accent">
          {error}
        </p>
      )}
    </motion.div>,
    document.body,
  );
}
