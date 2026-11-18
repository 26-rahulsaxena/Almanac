"use client";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Inbox } from "./inbox";

type Person = { email: string; name: string; sent: number; received: number; last_at: string | null };
type Meeting = { id: string; calendarId: string; title: string; start: string; end: string; allDay: boolean };
type Find = { id: string; title: string; kind: string; start_at: string };
type Detail = { person: Person | null; meetings: Meeting[] | null; finds: Find[] };

const day = (iso: string, o: Intl.DateTimeFormatOptions = {}) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(new Date(iso).getFullYear() !== new Date().getFullYear() && { year: "numeric" }), ...o });
const shown = (p: Pick<Person, "name" | "email">) => p.name || p.email;
const initial = (p: Pick<Person, "name" | "email">) => shown(p).trim()[0]?.toUpperCase() ?? "?";
const times = (n: number) => (n === 1 ? "once" : `${n} times`);

function Avatar({ p, big }: { p: Pick<Person, "name" | "email">; big?: boolean }) {
  // A steady colour per person, from the categories' palette.
  const hue = [...p.email].reduce((h, c) => h + c.charCodeAt(0), 0) % 6;
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-full font-medium text-white ${big ? "size-14 text-2xl" : "size-9 text-sm"}`} style={{ background: `var(--cat-${hue + 1})` }}>
      {initial(p)}
    </span>
  );
}

// People: everyone you email with, latest first, gathered from your Gmail (Almanac counts From, To and Cc, never
// reads the emails for this). Tap someone for their page: your meetings with them and all your emails together.
// open: a person to show straight away (a sender's name tapped in Mail). onMeet: a new meeting with them.
export function People({ version, open: first, onMeet, onMakeEvent, onChanged }: { version: number; open?: string | null; onMeet: (email: string, name: string) => void; onMakeEvent: (title: string, note: string) => void; onChanged: () => void }) {
  const [list, setList] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<string | null>(first ?? null);

  useEffect(() => {
    fetch("/api/people")
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (r.ok) setList(d);
        else setError(d?.error === "reauth" ? "Google needs you to sign in again." : (d?.error ?? "Couldn't load people. Try again."));
      })
      .catch(() => setError("Couldn't load people. Check your connection."));
  }, [version]);

  const found = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (list ?? []).filter((p) => !f || p.name.toLowerCase().includes(f) || p.email.includes(f));
  }, [list, filter]);

  if (open) {
    return (
      <PersonPage
        key={open}
        email={open}
        known={list?.find((p) => p.email === open)}
        version={version}
        onBack={() => setOpen(null)}
        onHidden={() => {
          setList((l) => l && l.filter((p) => p.email !== open));
          setOpen(null);
        }}
        onMeet={onMeet}
        onMakeEvent={onMakeEvent}
        onChanged={onChanged}
        onPerson={setOpen}
      />
    );
  }

  return (
    <section aria-label="People" className="mx-auto max-w-2xl lg:h-full lg:overflow-y-auto">
      <input
        type="search"
        aria-label="Find a person"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Find someone by name or email"
        className="w-full rounded-full border border-line bg-surface px-4 py-2 text-sm placeholder:text-muted focus:border-accent/60 focus:outline-none"
      />
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-accent/10 px-3 py-2 text-xs text-accent">
          {error}
        </p>
      )}
      {!list ? (
        !error && <p className="mt-6 text-center text-sm text-muted">Gathering the people you email with…</p>
      ) : !list.length ? (
        <p className="mt-6 rounded-2xl border border-line bg-surface p-4 text-sm text-muted">
          No one yet. People you write to, and who write to your Primary inbox, show up here once Gmail is connected (newsletters and automated senders are left out).
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {found.map((p) => (
            <li key={p.email}>
              <button type="button" onClick={() => setOpen(p.email)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-ink/[0.03]">
                <Avatar p={p} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{shown(p)}</span>
                  {p.name && <span className="block truncate text-xs text-muted">{p.email}</span>}
                </span>
                {p.last_at && <span className="shrink-0 text-xs text-muted">{day(p.last_at)}</span>}
              </button>
            </li>
          ))}
          {!found.length && <li className="py-6 text-center text-sm text-muted">No one matches “{filter}”.</li>}
        </ul>
      )}
    </section>
  );
}

// One person: who they are, what you have with them (meetings, things found in their emails), and all your emails
// with them, read and answered right here.
function PersonPage({
  email,
  known,
  version,
  onBack,
  onHidden,
  onMeet,
  onMakeEvent,
  onChanged,
  onPerson,
}: {
  email: string;
  known?: Person;
  version: number;
  onBack: () => void;
  onHidden: () => void;
  onMeet: (email: string, name: string) => void;
  onMakeEvent: (title: string, note: string) => void;
  onChanged: () => void;
  onPerson: (email: string) => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/people?${new URLSearchParams({ email })}`)
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (r.ok) setD(data);
        else setError(data?.error === "reauth" ? "Google needs you to sign in again." : (data?.error ?? "Couldn't load this person."));
      })
      .catch(() => setError("Couldn't load this person. Check your connection."));
  }, [email, version]);

  const p = d?.person ?? known ?? { email, name: "", sent: 0, received: 0, last_at: null };
  const now = new Date().toISOString();
  const next = d?.meetings?.filter((m) => m.end >= now) ?? [];
  const past = d?.meetings?.filter((m) => m.end < now).reverse().slice(0, 3) ?? [];
  const first = shown(p).split(/[\s@]/)[0];

  async function hide() {
    if (!confirm(`Take ${shown(p)} off People? They won't be added again.`)) return;
    const r = await fetch("/api/people", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, action: "hide" }) }).catch(() => null);
    if (r?.ok) onHidden();
    else setError("Couldn't remove them. Try again.");
  }

  const meeting = (m: Meeting) => (
    <li key={`${m.calendarId}:${m.id}`} className="flex items-baseline gap-2 py-1.5 text-sm">
      <span className="min-w-0 flex-1 truncate">{m.title}</span>
      <span className="shrink-0 text-xs text-muted">{m.allDay ? day(m.start) : day(m.start, { weekday: "short", hour: "numeric", minute: "2-digit" })}</span>
    </li>
  );

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="lg:grid lg:h-full lg:min-h-0 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-6">
      <aside className="min-w-0 lg:min-h-0 lg:overflow-y-auto">
        <button type="button" onClick={onBack} className="text-sm text-muted hover:text-ink">
          ← People
        </button>
        <div className="mt-3 flex items-center gap-3">
          <Avatar p={p} big />
          <div className="min-w-0">
            <h2 className="break-words font-serif text-2xl leading-tight">{shown(p)}</h2>
            {p.name && <p className="break-all text-xs text-muted">{p.email}</p>}
          </div>
        </div>
        {(p.sent > 0 || p.received > 0) && (
          <p className="mt-3 text-xs text-muted">
            {[p.sent && `You've written to ${first} ${times(p.sent)}`, p.received && `${first} has written ${times(p.received)}`].filter(Boolean).join(" · ")}
            {p.last_at && ` · last on ${day(p.last_at)}`}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => onMeet(email, p.name)} className="rounded-full border border-line px-4 py-1.5 text-sm hover:border-ink/40">
            Meeting
          </button>
          {d?.person && (
            <button type="button" onClick={hide} className="rounded-full px-3 py-1.5 text-xs text-muted hover:text-ink">
              Not a person
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-xs text-accent">
            {error}
          </p>
        )}

        {!!d?.finds.length && (
          <section className="mt-5 rounded-2xl border border-accent/50 bg-surface p-3">
            <h3 className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted">Found in their emails</h3>
            <ul className="mt-1">
              {d.finds.map((f) => (
                <li key={f.id} className="py-1 text-sm">
                  {f.title} <span className="text-xs text-muted">· {f.kind === "deadline" ? "due" : f.kind} {day(f.start_at, { weekday: "short" })}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted">Add them from Found in your email, at the top of Mail.</p>
          </section>
        )}

        <section className="mt-5">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted">Meetings</h3>
          {!d ? (
            <p className="mt-1 text-sm text-muted">Looking…</p>
          ) : d.meetings === null ? (
            <p className="mt-1 text-sm text-muted">Couldn&apos;t check your calendar just now.</p>
          ) : !d.meetings.length ? (
            <p className="mt-1 text-sm text-muted">None with {first} in the past or next year.</p>
          ) : (
            <>
              {next.length > 0 && <ul className="divide-y divide-line">{next.slice(0, 5).map(meeting)}</ul>}
              {past.length > 0 && (
                <>
                  <p className="mt-2 text-xs text-muted">Before</p>
                  <ul className="divide-y divide-line opacity-70">{past.map(meeting)}</ul>
                </>
              )}
            </>
          )}
        </section>
      </aside>

      <div className="mt-6 min-w-0 lg:mt-0 lg:min-h-0">
        <Inbox version={version} query={`{from:${email} to:${email} cc:${email}}`} writeTo={email} onMakeEvent={onMakeEvent} onChanged={onChanged} onPerson={(e) => e !== email && onPerson(e)} />
      </div>
    </motion.div>
  );
}
