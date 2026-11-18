"use client";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Compose, type Draft, type MailAccount } from "./compose";
import { GoogleSignIn, startLink } from "./google-sign-in";
import { useDialog } from "./use-dialog";

// The same shapes as lib/inbox.ts sends (dates as ISO strings).
type Row = { id: string; account: string; accountEmail: string; subject: string; people: string; snippet: string; date: string; unread: boolean; starred: boolean; inbox: boolean; count: number };
type Attachment = { id: string; name: string; mime: string; size: number; cid: string | null };
type Msg = { id: string; from: string; fromEmail: string | null; to: string; cc: string; date: string; subject: string; html: string | null; text: string; attachments: Attachment[]; unread: boolean };
type List = { threads: Row[]; next: Record<string, string> | null; failed: string[]; accounts: MailAccount[] };
type View = "primary" | "inbox" | "starred" | "sent" | "all";
type Action = "archive" | "unarchive" | "read" | "unread" | "star" | "unstar" | "trash" | "untrash";

const VIEWS: [View, string][] = [
  ["primary", "Primary"],
  ["inbox", "All inbox"],
  ["starred", "Starred"],
  ["sent", "Sent"],
];
const ALLOW = "Almanac may only read this account's mail. Press Allow at the top of the inbox first.";
const errorText = (d: { error?: string } | null) =>
  d?.error === "allow" ? ALLOW : d?.error === "reauth" ? "Google needs you to sign in again." : (d?.error ?? "Couldn't reach Gmail. Try again.");

// "4:05 pm" today, "12 Nov" this year, "12 Nov 2025" before.
function when(iso: string, long = false) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString() && !long) return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  const o: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() && { year: "numeric" }), ...(long && { weekday: "short", hour: "numeric", minute: "2-digit" }) };
  return d.toLocaleString("en-IN", o);
}
const emails = (s: string) => [...new Set((s.match(/[^\s<>",;:()]+@[^\s<>",;:()]+\.[^\s<>",;:()]+/g) ?? []).map((e) => e.toLowerCase()))];
const nameOf = (from: string) => from.replace(/<[^>]*>/, "").replace(/"/g, "").trim() || from;
const plain = (m: Msg) => m.text || (m.html ? (new DOMParser().parseFromString(m.html, "text/html").body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim() : "");
const fileUrl = (row: Row, m: Msg, a: Attachment) => `/api/inbox?${new URLSearchParams({ account: row.account, message: m.id, attachment: a.id, name: a.name, mime: a.mime })}`;
// Pictures pasted into the email ("cid:" links) point at their attachment instead; those then don't show as files.
const inline = (html: string, atts: Attachment[], url: (a: Attachment) => string) =>
  atts.reduce((h, a) => (a.cid ? h.split(`cid:${a.cid}`).join(url(a).replace(/&/g, "&amp;")) : h), html);
const files = (m: Msg) => m.attachments.filter((a) => !(a.cid && m.html?.includes(`cid:${a.cid}`)));
const kb = (n: number) => (n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

// The inbox: every connected Google account's mail in one list, read, answered and tidied without leaving Almanac.
// Wide screens: the list and the open conversation side by side; phones: one at a time. children: shown above the
// list (what was found in your email). onMakeEvent: open a new event with this title; onChanged: a to-do was added.
// query: only this Gmail search, everywhere (a person's page), with Write addressed to writeTo. onPerson: a sender's
// name was tapped.
export function Inbox({
  version,
  onMakeEvent,
  onChanged,
  onPerson,
  query: fixed,
  writeTo,
  children,
}: {
  version: number;
  onMakeEvent: (title: string, note: string) => void;
  onChanged: () => void;
  onPerson?: (email: string) => void;
  query?: string;
  writeTo?: string;
  children?: ReactNode;
}) {
  const [view, setView] = useState<View>(fixed ? "all" : "primary");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState(fixed ?? "");
  const [list, setList] = useState<List | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Row | null>(null);
  const [toast, setToast] = useState<{ key: number; text: string; undo?: () => void } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  // The drawer: which mailbox (one account's id; null: all of them together) and, on phones, whether it's out.
  const [box, setBox] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [counts, setCounts] = useState<{ id: string; unread: number }[] | null>(null);
  const asked = useRef(0); // the latest list asked for; older answers arriving late are dropped

  const load = useCallback(
    async (more?: Record<string, string>) => {
      const n = ++asked.current;
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ view, q: search });
      if (more) params.set("page", JSON.stringify(more));
      if (box) params.set("box", box);
      // The drawer's unread numbers, read again with each fresh list.
      if (!more && !fixed)
        fetch("/api/inbox?counts=1")
          .then((r) => (r.ok ? r.json() : null))
          .then((c) => Array.isArray(c) && setCounts(c))
          .catch(() => {});
      try {
        const r = await fetch(`/api/inbox?${params}`);
        const d = await r.json().catch(() => null);
        if (n !== asked.current) return;
        if (!r.ok) return setError(errorText(d));
        setList((prev) => (more && prev ? { ...d, threads: [...prev.threads, ...d.threads.filter((t: Row) => !prev.threads.some((p) => p.id === t.id && p.account === t.account))] } : d));
      } catch {
        if (n === asked.current) setError("Couldn't reach Gmail. Check your connection.");
      } finally {
        if (n === asked.current) setLoading(false);
      }
    },
    [view, search, box, fixed],
  );
  useEffect(() => {
    const t = setTimeout(load); // after this render, so typing a search or switching views fast asks once
    return () => clearTimeout(t);
  }, [load, version]);

  const say = (text: string, undo?: () => void) => setToast({ key: Date.now(), text, undo });
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const patch = (row: Row, change: Partial<Row>) => {
    setList((l) => l && { ...l, threads: l.threads.map((t) => (t.id === row.id && t.account === row.account ? { ...t, ...change } : t)) });
    setOpen((o) => (o && o.id === row.id && o.account === row.account ? { ...o, ...change } : o));
  };
  const canAct = (row: Row) => !!list?.accounts.find((a) => a.id === row.account)?.send;

  async function act(row: Row, action: Action) {
    const r = await fetch("/api/inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, account: row.account, thread: row.id }) }).catch(() => null);
    if (r?.ok) return true;
    setError(errorText(await r?.json().catch(() => null)));
    return false;
  }

  // Archive and Bin take the conversation off the list at once, with Undo; it comes back if Gmail says no.
  async function remove(row: Row, action: "archive" | "trash") {
    if (!canAct(row)) return setError(ALLOW);
    const at = list?.threads.findIndex((t) => t.id === row.id && t.account === row.account) ?? -1;
    const putBack = () => setList((l) => l && { ...l, threads: l.threads.some((t) => t.id === row.id) ? l.threads : [...l.threads.slice(0, at), row, ...l.threads.slice(at)] });
    const off = action === "trash" || view === "primary" || view === "inbox";
    if (off) setList((l) => l && { ...l, threads: l.threads.filter((t) => !(t.id === row.id && t.account === row.account)) });
    else patch(row, { inbox: false });
    if (open?.id === row.id) setOpen(null);
    if (!(await act(row, action))) return off ? putBack() : patch(row, { inbox: true });
    say(action === "trash" ? "Moved to Bin" : "Archived", async () => {
      setToast(null);
      if (!(await act(row, action === "trash" ? "untrash" : "unarchive"))) return;
      if (off) putBack();
      else patch(row, { inbox: true });
    });
  }

  async function toggle(row: Row, key: "unread" | "starred") {
    if (!canAct(row)) return setError(ALLOW);
    const on = !row[key];
    patch(row, { [key]: on });
    const action: Action = key === "unread" ? (on ? "unread" : "read") : on ? "star" : "unstar";
    if (!(await act(row, action))) patch(row, { [key]: !on });
  }

  function openRow(row: Row) {
    setOpen(row);
    if (row.unread && canAct(row)) {
      patch(row, { unread: false });
      act(row, "read").then((ok) => ok || patch(row, { unread: true }));
    }
  }

  async function addTodo(title: string) {
    const r = await fetch("/api/todos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title.slice(0, 200) || "Email to deal with" }) }).catch(() => null);
    if (!r?.ok) return setError("Couldn't add the to-do. Try again.");
    onChanged();
    say("Added to your to-dos");
  }

  const accounts = list?.accounts ?? [];
  const readOnly = accounts.filter((a) => !a.send && (!box || a.id === box)); // only the mailbox you're in
  // Write sends from the mailbox you're in when it can send, otherwise from the first account that can.
  const writer = accounts.find((a) => a.id === box && a.send) ?? accounts.find((a) => a.send);
  const compose = (d: Partial<Draft> & { title: string }) => writer && setDraft({ account: writer.id, to: "", cc: "", bcc: "", subject: "", body: "", ...d });
  const pick = (b: string | null, v: View) => {
    setBox(b);
    setView(v);
    setList(null);
    setOpen(null);
    setDrawer(false);
  };
  const boxName = box ? (accounts.find((a) => a.id === box)?.email ?? "Mailbox") : "All inboxes";
  const drawerBody = (
    <MailDrawer
      accounts={accounts}
      counts={counts}
      box={box}
      view={view}
      onPick={pick}
      onWrite={writer ? () => (setDrawer(false), compose({ title: "New email" })) : undefined}
    />
  );

  return (
    <div className="lg:grid lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-6">
      <AnimatePresence>
        {!fixed && drawer && (
          <Drawer key="drawer" onClose={() => setDrawer(false)}>
            {drawerBody}
          </Drawer>
        )}
      </AnimatePresence>
      <section aria-label="Inbox" className={`min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pr-1 ${open ? "max-lg:hidden" : ""}`}>
        {!fixed && (
          // First thing above the list: which mailbox and folder you're in; tap the three lines for the drawer.
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label={`Mailboxes: ${boxName}, ${VIEWS.find(([v]) => v === view)?.[1]}`}
            aria-expanded={drawer}
            className="mb-2 flex w-full items-center gap-2 rounded-xl px-1 py-1.5 text-left hover:bg-ink/[0.03]"
          >
            <svg className="size-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M4 6h16M4 12h16M4 18h10" />
            </svg>
            <span className="min-w-0 truncate text-sm font-medium">{boxName}</span>
            <span className="shrink-0 text-xs text-muted">· {VIEWS.find(([v]) => v === view)?.[1]}</span>
            <svg className="ml-auto size-4 shrink-0 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        )}
        {readOnly.length > 0 && (
          <div className="mb-3 rounded-2xl border border-accent/50 bg-surface p-3 text-sm">
            <p>Reply, archive and send without leaving Almanac: allow it in Google{accounts.length > 1 ? " for each account" : ""}.</p>
            <ul className="mt-2 space-y-1.5">
              {readOnly.map((a) => (
                <li key={a.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs text-muted">{a.email}</span>
                  {a.main ? (
                    <GoogleSignIn gmail="allow">
                      <button type="submit" className="rounded-full bg-ink px-3 py-1 text-xs font-medium text-paper">
                        Allow
                      </button>
                    </GoogleSignIn>
                  ) : (
                    <button type="button" onClick={() => startLink(true).catch(() => setError("Couldn't open Google. Try again."))} className="rounded-full bg-ink px-3 py-1 text-xs font-medium text-paper">
                      Allow
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {children}

        {fixed ? (
          <div className="flex items-center gap-2">
            <h3 className="flex-1 font-mono text-[10px] uppercase tracking-[0.25em] text-muted">Emails</h3>
            {writer && (
              <button type="button" onClick={() => compose({ title: "New email", to: writeTo ?? "" })} className="shrink-0 rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-paper">
                Write
              </button>
            )}
          </div>
        ) : (
        <>
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(query.trim());
          }}
          className="mt-1 flex items-center gap-2"
        >
          <input
            type="search"
            aria-label="Search mail"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!e.target.value) setSearch("");
            }}
            placeholder="Search mail (from:priya, has:attachment…)"
            className="min-w-0 flex-1 rounded-full border border-line bg-surface px-4 py-2 text-sm placeholder:text-muted focus:border-accent/60 focus:outline-none"
          />
          <button type="button" onClick={() => load()} aria-label="Refresh" title="Refresh" className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:text-ink">
            <svg className={`size-4 ${loading ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4.5h-4.5" />
            </svg>
          </button>
        </form>
        </>
        )}

        {error && (
          <p role="alert" className="mt-2 rounded-xl bg-accent/10 px-3 py-2 text-xs text-accent">
            {error}
          </p>
        )}
        {!!list?.failed.length && <p className="mt-2 text-xs text-muted">Couldn&apos;t load {list.failed.join(", ")} right now.</p>}

        {!list ? (
          !error && <p className="mt-6 text-center text-sm text-muted">Loading your mail…</p>
        ) : !accounts.length ? (
          <div className="mt-4 rounded-2xl border border-line bg-surface p-4 text-sm">
            <p>Connect Gmail to read and answer your email here.</p>
            <GoogleSignIn gmail="allow" className="mt-3">
              <button type="submit" className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper">
                Connect Gmail
              </button>
            </GoogleSignIn>
          </div>
        ) : !list.threads.length ? (
          <p className="mt-6 text-center text-sm text-muted">{search ? `Nothing found for “${search}”.` : "Nothing here. All caught up."}</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            <AnimatePresence initial={false}>
              {list.threads.map((t) => (
                <motion.li key={`${t.account}:${t.id}`} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }} className="group relative">
                  <button
                    type="button"
                    onClick={() => openRow(t)}
                    aria-current={open?.id === t.id || undefined}
                    className={`block w-full rounded-xl px-2 py-2.5 pr-9 text-left hover:bg-ink/[0.03] ${open?.id === t.id ? "bg-ink/[0.05]" : ""}`}
                  >
                    <span className="flex items-baseline gap-2">
                      {t.unread && <span className="size-2 shrink-0 self-center rounded-full bg-accent" aria-label="Unread" />}
                      <span className={`min-w-0 flex-1 truncate text-sm ${t.unread ? "font-semibold" : ""}`}>{t.people}</span>
                      <span className={`shrink-0 text-xs ${t.unread ? "font-semibold text-ink" : "text-muted"}`}>{when(t.date)}</span>
                    </span>
                    <span className={`mt-0.5 block truncate text-sm ${t.unread ? "font-medium" : ""}`}>{t.subject}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {accounts.length > 1 && !box && <span className="mr-1 rounded bg-ink/[0.06] px-1">{t.accountEmail.split("@")[0]}</span>}
                      {t.snippet}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggle(t, "starred")}
                    aria-label={t.starred ? "Unstar" : "Star"}
                    aria-pressed={t.starred}
                    className={`absolute right-1 bottom-2 grid size-7 place-items-center rounded-full ${t.starred ? "text-amber-500" : "text-muted/60 hover:text-ink"}`}
                  >
                    {t.starred ? "★" : "☆"}
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
        {list?.next && (
          <button type="button" disabled={loading} onClick={() => load(list.next!)} className="mx-auto mt-3 mb-4 block rounded-full border border-line px-4 py-1.5 text-xs hover:border-ink/40 disabled:opacity-50">
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </section>

      <section aria-label="Conversation" className={`min-w-0 lg:min-h-0 lg:overflow-y-auto ${open ? "" : "max-lg:hidden"}`}>
        {open ? (
          <Thread
            key={`${open.account}:${open.id}`}
            row={open}
            me={open.accountEmail}
            canAct={canAct(open)}
            onBack={() => setOpen(null)}
            onRemove={(a) => remove(open, a)}
            onToggle={(k) => toggle(open, k)}
            onTodo={() => addTodo(open.subject)}
            onEvent={(note) => onMakeEvent(open.subject, note)}
            onPerson={onPerson}
            onCompose={(d) => (canAct(open) ? setDraft({ account: open.account, to: "", cc: "", bcc: "", subject: "", body: "", ...d }) : setError(ALLOW))}
          />
        ) : (
          <p className="hidden h-full place-items-center text-sm text-muted lg:grid">Pick an email to read it here.</p>
        )}
      </section>

      <AnimatePresence>
        {draft && (
          <Compose
            key="compose"
            draft={draft}
            accounts={accounts}
            onClose={() => setDraft(null)}
            onSent={() => {
              setDraft(null);
              say("Sent");
              setTimeout(() => load(), 1500); // Gmail lists a sent email after a moment
            }}
          />
        )}
      </AnimatePresence>

      {/* Write, floating where the calendar's + button is elsewhere (Mail hides that one). A portal, so the phone
          page's sliding transform doesn't hold it inside. Not on a person's page, which has its own Write. */}
      {!fixed &&
        writer &&
        !draft &&
        createPortal(
          <motion.button
            type="button"
            onClick={() => compose({ title: "New email" })}
            whileTap={{ scale: 0.94 }}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="fixed right-5 bottom-[4.75rem] z-30 flex items-center gap-2 rounded-full bg-ink px-5 py-3.5 text-sm font-medium text-paper shadow-xl max-lg:bottom-[calc(9.75rem+env(safe-area-inset-bottom))]"
          >
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />
            </svg>
            Write
          </motion.button>,
          document.body,
        )}

      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 max-lg:bottom-[calc(6.25rem+env(safe-area-inset-bottom))]">
        <AnimatePresence>
          {toast && (
            <motion.div key={toast.key} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} className="pointer-events-auto flex items-center gap-3 rounded-full bg-ink px-4 py-2 text-sm text-paper shadow-xl">
              {toast.text}
              {toast.undo && (
                <button type="button" onClick={toast.undo} className="font-medium text-accent">
                  Undo
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// The drawer: Write, then the mailboxes (all of them together, then each account, with unread in Primary), then
// the folders of the one you're in. Slides out from the left from the three-lines button above the list.
function MailDrawer({
  accounts,
  counts,
  box,
  view,
  onPick,
  onWrite,
}: {
  accounts: MailAccount[];
  counts: { id: string; unread: number }[] | null;
  box: string | null;
  view: View;
  onPick: (box: string | null, view: View) => void;
  onWrite?: () => void;
}) {
  const unread = (id: string | null) => (counts ? (id ? (counts.find((c) => c.id === id)?.unread ?? 0) : counts.reduce((n, c) => n + c.unread, 0)) : 0);
  const item = (on: boolean) => `flex w-full items-center gap-2 rounded-full px-3 py-2 text-left text-sm ${on ? "bg-ink/[0.07] font-medium" : "hover:bg-ink/[0.04]"}`;
  const count = (n: number) => n > 0 && <span className="ml-auto shrink-0 text-xs tabular-nums text-muted">{n >= 500 ? "500+" : n}</span>;
  const boxes: [string | null, string][] = [[null, "All inboxes"], ...accounts.map((a): [string, string] => [a.id, a.email])];
  return (
    <nav className="space-y-5">
      {onWrite && (
        <button type="button" onClick={onWrite} className="flex items-center gap-2 rounded-2xl bg-ink px-4 py-2.5 text-sm font-medium text-paper">
          <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />
          </svg>
          Write
        </button>
      )}
      <div>
        <h3 className="px-3 font-mono text-[10px] uppercase tracking-[0.25em] text-muted">Mailboxes</h3>
        <ul className="mt-1 space-y-0.5">
          {(accounts.length > 1 ? boxes : boxes.slice(1)).map(([id, label]) => (
            <li key={id ?? "all"}>
              <button type="button" aria-current={box === id || (accounts.length === 1 && !box) || undefined} onClick={() => onPick(id, view)} className={item(box === id || (accounts.length === 1 && !box))}>
                <span className="min-w-0 truncate" title={label}>
                  {label}
                </span>
                {count(unread(id))}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="px-3 font-mono text-[10px] uppercase tracking-[0.25em] text-muted">Folders</h3>
        <ul className="mt-1 space-y-0.5">
          {VIEWS.map(([v, label]) => (
            <li key={v}>
              <button type="button" aria-current={view === v || undefined} onClick={() => onPick(box, v)} className={item(view === v)}>
                {label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

// The drawer, sliding out from the left over a dimmed page; tap outside or Esc to close. Drawn at the top of the page
// (a portal), so it's above the full-window Mail and isn't held inside the phone page's sliding transform.
function Drawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useDialog<HTMLDivElement>(onClose);
  return createPortal(
    <>
      <motion.div className="fixed inset-0 z-40 bg-ink/25" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Mailboxes"
        initial={{ x: "-100%" }}
        animate={{ x: 0 }}
        exit={{ x: "-100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 320 }}
        className="fixed inset-y-0 left-0 z-50 w-[min(18rem,85vw)] overflow-y-auto rounded-r-3xl border-r border-line bg-surface p-4 pt-[calc(1rem+env(safe-area-inset-top))] shadow-2xl"
      >
        {children}
      </motion.div>
    </>,
    document.body,
  );
}

const iconButton = "grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-ink/5 hover:text-ink disabled:opacity-40";

// One conversation: oldest first, earlier read messages folded to a line; the actions on top, Reply under the last.
function Thread({
  row,
  me,
  canAct,
  onBack,
  onRemove,
  onToggle,
  onTodo,
  onEvent,
  onCompose,
  onPerson,
}: {
  row: Row;
  me: string;
  canAct: boolean;
  onBack: () => void;
  onRemove: (a: "archive" | "trash") => void;
  onToggle: (k: "unread" | "starred") => void;
  onTodo: () => void;
  onEvent: (note: string) => void;
  onCompose: (d: Partial<Draft> & { title: string }) => void;
  onPerson?: (email: string) => void;
}) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unfolded, setUnfolded] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`/api/inbox?${new URLSearchParams({ account: row.account, thread: row.id })}`)
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (r.ok) setMsgs(d.messages);
        else setError(errorText(d));
      })
      .catch(() => setError("Couldn't reach Gmail. Check your connection."));
  }, [row.account, row.id]);

  const last = msgs?.at(-1);
  const mine = me.toLowerCase();
  const reply = (all: boolean) => {
    if (!last) return;
    const fromMe = last.fromEmail === mine;
    const to = fromMe ? emails(last.to) : [last.fromEmail ?? ""].filter(Boolean);
    const cc = all ? emails(`${last.to}, ${last.cc}`).filter((e) => e !== mine && !to.includes(e)) : [];
    const subj = last.subject || row.subject;
    onCompose({ title: all ? "Reply all" : "Reply", to: to.join(", "), cc: cc.join(", "), subject: /^re:/i.test(subj) ? subj : `Re: ${subj}`, replyTo: last.id });
  };
  const forward = () => {
    if (!last) return;
    const head = `---------- Forwarded message ----------\nFrom: ${last.from}\nDate: ${when(last.date, true)}\nSubject: ${last.subject}\nTo: ${last.to}\n\n`;
    onCompose({ title: "Forward", subject: /^fwd?:/i.test(last.subject) ? last.subject : `Fwd: ${last.subject}`, body: `\n\n${head}${plain(last)}` });
  };

  return (
    <article className="pb-6">
      <div className="sticky top-0 z-10 flex items-center gap-0.5 border-b border-line bg-paper/90 py-1 backdrop-blur">
        <button type="button" onClick={onBack} aria-label="Back to the inbox" className={`${iconButton} lg:hidden`}>
          ←
        </button>
        <button type="button" disabled={!canAct} onClick={() => onRemove("archive")} aria-label={row.inbox ? "Archive" : "Already archived"} title="Archive" className={iconButton}>
          <svg className="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="4" width="18" height="5" rx="1.5" />
            <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" />
          </svg>
        </button>
        <button type="button" disabled={!canAct} onClick={() => onRemove("trash")} aria-label="Move to Bin" title="Move to Bin" className={iconButton}>
          <svg className="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
          </svg>
        </button>
        <button type="button" disabled={!canAct} onClick={() => (onToggle("unread"), onBack())} aria-label="Mark unread" title="Mark unread" className={iconButton}>
          <svg className="size-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3.5 6.5 8.5 6 8.5-6" />
          </svg>
        </button>
        <button type="button" disabled={!canAct} onClick={() => onToggle("starred")} aria-label={row.starred ? "Unstar" : "Star"} aria-pressed={row.starred} title="Star" className={`${iconButton} ${row.starred ? "text-amber-500" : ""}`}>
          {row.starred ? "★" : "☆"}
        </button>
        <span className="flex-1" />
        <button type="button" onClick={onTodo} className="shrink-0 rounded-full border border-line px-3 py-1 text-xs hover:border-ink/40">
          To-do
        </button>
        <button type="button" onClick={() => onEvent(last ? `Email from ${nameOf(last.from)}: “${row.subject}”` : "")} className="ml-1 shrink-0 rounded-full border border-line px-3 py-1 text-xs hover:border-ink/40">
          Event
        </button>
      </div>

      <h2 className="mt-3 break-words font-serif text-2xl leading-tight">{row.subject}</h2>
      {error && (
        <p role="alert" className="mt-3 text-sm text-accent">
          {error}
        </p>
      )}
      {!msgs && !error && <p className="mt-4 text-sm text-muted">Opening…</p>}
      <ol className="mt-3 space-y-3">
        {msgs?.map((m, i) => {
          const folded = i < msgs.length - 1 && !m.unread && !unfolded.has(m.id);
          return (
            <li key={m.id} className="rounded-2xl border border-line bg-surface">
              <div className="flex w-full items-baseline gap-2 px-3 pt-2.5 pb-1">
                <span className="min-w-0 flex-1">
                  {onPerson && m.fromEmail && m.fromEmail !== mine ? (
                    <button type="button" onClick={() => onPerson(m.fromEmail!)} title="Open their page in People" className="block max-w-full truncate text-left text-sm font-medium hover:underline">
                      {nameOf(m.from)}
                    </button>
                  ) : (
                    <span className="block truncate text-sm font-medium">{m.fromEmail === mine ? "Me" : nameOf(m.from)}</span>
                  )}
                  {!folded && <span className="block truncate text-xs text-muted">to {m.to.split(",").map((x) => (emails(x)[0] === mine ? "me" : nameOf(x.trim()))).join(", ")}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted">{when(m.date, true)}</span>
              </div>
              {folded ? (
                <button type="button" onClick={() => setUnfolded((s) => new Set(s).add(m.id))} className="block w-full truncate px-3 pb-2.5 text-left text-xs text-muted hover:text-ink">
                  {plain(m).slice(0, 160)}
                </button>
              ) : (
                <div className="px-3 pb-3">
                  {m.html ? <EmailFrame html={inline(m.html, m.attachments, (a) => fileUrl(row, m, a))} /> : <TextBody text={m.text} />}
                  {files(m).length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {files(m).map((a) => (
                        <li key={a.id}>
                          <a
                            href={fileUrl(row, m, a)}
                            target="_blank"
                            rel="noopener"
                            className="flex max-w-60 items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-xs hover:border-ink/40"
                          >
                            <span aria-hidden>📎</span>
                            <span className="truncate">{a.name}</span>
                            <span className="shrink-0 text-muted">{kb(a.size)}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {last && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => reply(false)} className="rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-paper">
            Reply
          </button>
          {emails(`${last.to}, ${last.cc}`).filter((e) => e !== mine).length > 1 && (
            <button type="button" onClick={() => reply(true)} className="rounded-full border border-line px-4 py-1.5 text-sm hover:border-ink/40">
              Reply all
            </button>
          )}
          <button type="button" onClick={forward} className="rounded-full border border-line px-4 py-1.5 text-sm hover:border-ink/40">
            Forward
          </button>
        </div>
      )}
    </article>
  );
}

// A plain-text email, with its web links clickable.
function TextBody({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
      {text.split(/(https?:\/\/[^\s<>"]+)/g).map((part, i) =>
        i % 2 ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-accent underline">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </p>
  );
}

// An HTML email, in a frame where nothing in it can run (no scripts, forms or access to Almanac). Pictures and
// styles from the web stay off until Show pictures, so opening an email doesn't tell the sender you read it.
function EmailFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(80);
  const [pictures, setPictures] = useState(false);
  const remote = /<img[^>]+src=["']?https?:|url\(\s*["']?https?:/i.test(html);
  const web = pictures ? " https: http:" : "";
  // Pictures pasted into the email come through Almanac's /api/inbox (no one learns you opened it); only that path,
  // so an email can't make the browser call Almanac's other addresses.
  const own = typeof location === "undefined" ? "" : ` ${location.origin}/api/inbox`;
  const csp = `default-src 'none'; style-src 'unsafe-inline'${web}; img-src data:${own}${web}; font-src data:${web}`;
  const doc = `<meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>html,body{margin:0;background:#fff;color:#222;font:14px/1.5 system-ui,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style>${html}`;

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let obs: ResizeObserver | undefined;
    const fit = () => {
      const d = frame.contentDocument;
      if (!d?.documentElement || !d.body) return;
      // A newsletter laid out wider than the screen (often 600px) is shrunk to fit, as Gmail's app does.
      const wide = d.documentElement.scrollWidth;
      if (wide > frame.clientWidth + 2) d.body.style.zoom = String(frame.clientWidth / wide);
      setHeight(d.documentElement.scrollHeight);
      obs?.disconnect();
      obs = new ResizeObserver(() => setHeight(d.documentElement.scrollHeight));
      obs.observe(d.body ?? d.documentElement);
    };
    frame.addEventListener("load", fit);
    return () => {
      frame.removeEventListener("load", fit);
      obs?.disconnect();
    };
  }, []);

  return (
    <>
      {remote && !pictures && (
        <button type="button" onClick={() => setPictures(true)} className="mb-2 text-xs font-medium text-accent hover:underline">
          Show pictures
        </button>
      )}
      <iframe
        ref={ref}
        title="Email"
        // allow-same-origin without allow-scripts: Almanac can measure its height; nothing inside can run.
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={doc}
        style={{ height }}
        className="w-full rounded-lg border-0 bg-white"
      />
    </>
  );
}
