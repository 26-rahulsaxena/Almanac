"use client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { SyncResult } from "@/lib/sheet-sync";

type Status = { sheetId: string | null; syncedAt: string | null; canRead: boolean };

async function call(method: "GET" | "POST" | "DELETE", body?: object) {
  const r = await fetch("/api/sheet", { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error === "reauth" ? "Google needs you to sign in again." : (data?.error ?? "Something went wrong."));
  return data;
}

const ago = (iso: string, now: Date) => {
  const m = Math.round((+now - +new Date(iso)) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};
const when = (s: string) =>
  s.length === 10
    ? new Date(`${s}T00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })
    : new Date(s).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// Connects one Google Sheet whose rows become calendar events (synced every 15 minutes, or now on request).
export function SheetSync({ now, onCalendarChange }: { now: Date; onCalendarChange: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [link, setLink] = useState("");
  const [result, setResult] = useState<SyncResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call("GET").then(setStatus, (e: Error) => setError(e.message));
  }, []);

  async function run(label: string, body: object) {
    setBusy(label);
    setError(null);
    try {
      const r: SyncResult = await call("POST", body);
      setResult(r);
      if (r.created || r.updated || label === "delete") onCalendarChange();
      setStatus(await call("GET"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setStatus(await call("DELETE").then(() => call("GET")));
    setResult(null);
  }

  if (!status) return <p className="mt-3 text-xs text-muted">Loading…</p>;
  const button = "rounded-full px-3 py-1.5 text-sm disabled:opacity-50";

  return (
    <div className="mt-3 space-y-2 text-sm">
      {!status.canRead && (
        <p className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs">
          Almanac needs permission to read Google Sheets. Sign out, sign back in, and allow “See your Google Sheets spreadsheets”.
        </p>
      )}

      {!status.sheetId ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run("connect", { action: "connect", url: link });
          }}
          className="space-y-1.5"
        >
          <label className="block">
            <span className="sr-only">Google Sheet link</span>
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Paste a Google Sheet link…"
              className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={!link.trim() || !!busy} className={`${button} bg-ink font-medium text-paper`}>
              {busy ? "Connecting…" : "Connect"}
            </button>
            <a href="/almanac-sheet-template.csv" download className="text-xs text-muted underline underline-offset-2 hover:text-ink">
              Template (.csv)
            </a>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            One row per event: Title, Date, Start, End, Location, Notes. Leave Start empty for all-day. New and changed rows reach your calendar every 15 minutes.
          </p>
        </form>
      ) : (
        <>
          <p className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-[var(--cat-2)]" aria-hidden />
            <a href={`https://docs.google.com/spreadsheets/d/${status.sheetId}`} target="_blank" rel="noreferrer" className="truncate underline underline-offset-2">
              {result?.title ?? "Your sheet"}
            </a>
          </p>
          <p className="text-xs text-muted">{status.syncedAt ? `Synced ${ago(status.syncedAt, now)} · every 15 min` : "Not synced yet"}</p>
          <div className="flex flex-wrap gap-1">
            <button type="button" onClick={() => run("sync", { action: "sync" })} disabled={!!busy} className={`${button} border border-line hover:border-ink/40`}>
              {busy === "sync" ? "Syncing…" : "Sync now"}
            </button>
            <button type="button" onClick={disconnect} disabled={!!busy} className={`${button} text-muted hover:text-ink`} title="Stop syncing (events already made stay)">
              Disconnect
            </button>
          </div>
        </>
      )}

      <AnimatePresence>
        {result && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-2 text-xs" aria-live="polite">
            <p className="text-muted">
              {result.created} added · {result.updated} updated · {result.unchanged} unchanged
            </p>
            {result.problems.length > 0 && (
              <ul className="space-y-0.5 rounded-lg bg-ink/[0.04] px-3 py-2">
                {result.problems.slice(0, 8).map((p) => (
                  <li key={p.row}>
                    <span className="font-medium">Row {p.row}:</span> {p.message}
                  </li>
                ))}
                {result.problems.length > 8 && <li className="text-muted">…and {result.problems.length - 8} more</li>}
              </ul>
            )}
            {result.orphans.length > 0 && (
              <div className="rounded-lg border border-line px-3 py-2">
                <p>
                  {result.orphans.length} event{result.orphans.length === 1 ? " is" : "s are"} no longer in the sheet:
                </p>
                <ul className="my-1 list-disc pl-4 text-muted">
                  {result.orphans.slice(0, 6).map((o) => (
                    <li key={o.id}>
                      {o.title} · {when(o.start)}
                    </li>
                  ))}
                  {result.orphans.length > 6 && <li>…and {result.orphans.length - 6} more</li>}
                </ul>
                <p className="mb-1.5">Delete them from your calendar?</p>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => run("delete", { action: "delete", ids: result.orphans.map((o) => o.id) })}
                    className="rounded-full bg-accent px-3 py-1 font-medium text-paper disabled:opacity-50"
                  >
                    {busy === "delete" ? "Deleting…" : "Delete them"}
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => run("keep", { action: "keep", ids: result.orphans.map((o) => o.id) })}
                    className="rounded-full border border-line px-3 py-1 hover:border-ink/40 disabled:opacity-50"
                  >
                    Keep them
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <p role="alert" className="text-xs text-accent">
          {error}
        </p>
      )}
    </div>
  );
}
