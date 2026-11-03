"use client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import type { SyncResult } from "@/lib/sheet-sync";

type Picker = { key: string; appId: string; clientId: string; email: string };
type Status = { sheetId: string | null; name: string | null; syncedAt: string | null; canRead: boolean; picker: Picker | null };

async function call(method: "GET" | "POST" | "DELETE", body?: object) {
  const r = await fetch("/api/sheet", { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error === "reauth" ? "Google needs you to sign in again." : (data?.error ?? "Something went wrong."));
  return data;
}

// Just the parts of Google's picker and sign-in libraries used here.
type GoogleLibs = {
  gapi: { load: (lib: string, cb: () => void) => void };
  google: {
    accounts: {
      oauth2: {
        initTokenClient: (o: {
          client_id: string;
          scope: string;
          login_hint: string;
          callback: (r: { access_token?: string; error?: string }) => void;
          error_callback: (e: { type: string }) => void;
        }) => { requestAccessToken: (o: { prompt: string }) => void };
      };
    };
    picker: {
      PickerBuilder: new () => PickerBuilder;
      DocsView: new (id: string) => { setMode: (m: string) => unknown };
      ViewId: { SPREADSHEETS: string };
      DocsViewMode: { LIST: string };
      Action: { PICKED: string; CANCEL: string };
    };
  };
};
type PickerBuilder = {
  addView: (v: unknown) => PickerBuilder;
  setOAuthToken: (t: string) => PickerBuilder;
  setDeveloperKey: (k: string) => PickerBuilder;
  setAppId: (id: string) => PickerBuilder;
  setTitle: (t: string) => PickerBuilder;
  setCallback: (cb: (d: { action: string; docs?: { id: string }[] }) => void) => PickerBuilder;
  build: () => { setVisible: (v: boolean) => void };
};

const loadScript = (src: string) =>
  new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = Object.assign(document.createElement("script"), { src, async: true, onload: () => resolve(), onerror: reject });
    document.head.append(s);
  });

// Opens Google's own file picker. It runs on a separate short-lived token that can only open files you pick,
// never Almanac's saved Google login. Resolves to the chosen sheet's id, or null if you cancel.
async function pickSheet(cfg: Picker): Promise<string | null> {
  await Promise.all([loadScript("https://apis.google.com/js/api.js"), loadScript("https://accounts.google.com/gsi/client")]);
  // Re-checked once loaded: Google's scripts define these globals.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { gapi, google } = window as any as GoogleLibs;
  await new Promise<void>((r) => gapi.load("picker", r));
  const token = await new Promise<string>((resolve, reject) =>
    google.accounts.oauth2
      .initTokenClient({
        client_id: cfg.clientId,
        scope: "https://www.googleapis.com/auth/drive.file",
        login_hint: cfg.email,
        callback: (r) => (r.access_token ? resolve(r.access_token) : reject(new Error(r.error))),
        error_callback: (e) => reject(new Error(e.type)),
      })
      .requestAccessToken({ prompt: "" }),
  );
  const p = google.picker;
  return new Promise((resolve) =>
    new p.PickerBuilder()
      .addView(new p.DocsView(p.ViewId.SPREADSHEETS).setMode(p.DocsViewMode.LIST))
      .setOAuthToken(token)
      .setDeveloperKey(cfg.key)
      .setAppId(cfg.appId)
      .setTitle("Choose the sheet for your calendar")
      .setCallback((d) => {
        if (d.action === p.Action.PICKED) resolve(d.docs?.[0]?.id ?? null);
        else if (d.action === p.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true),
  );
}

const ago = (iso: string, now: Date) => {
  const m = Math.round((+now - +new Date(iso)) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};
const when = (s: string) =>
  s.length === 10
    ? new Date(`${s}T00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })
    : new Date(s).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// Connects one Google Sheet whose rows become calendar events. Checked every minute; synced when it changes.
export function SheetSync({ now, onCalendarChange }: { now: Date; onCalendarChange: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  // On opening the app: a full sync, so problems and removed rows show up here.
  useEffect(() => {
    call("GET").then((s: Status) => {
      setStatus(s);
      if (s.sheetId && s.canRead) run("sync", { action: "sync" });
    }, (e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  async function choose() {
    setError(null);
    try {
      const id = await pickSheet(status!.picker!);
      if (id) await run("connect", { action: "connect", id });
    } catch {
      setError("Couldn't open Google's file picker. Allow pop-ups for this site and try again.");
    }
  }

  async function disconnect() {
    await call("DELETE");
    setStatus(await call("GET"));
    setResult(null);
  }

  if (!status) return <p className="mt-3 text-xs text-muted">Loading…</p>;
  const button = "rounded-full px-3 py-1.5 text-sm disabled:opacity-50";
  const canChoose = status.canRead && !!status.picker;

  return (
    <div className="mt-3 space-y-2 text-sm">
      {!status.canRead && (
        <p className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs">
          To connect a sheet, sign out, sign back in, and allow Almanac to “see and edit only the Google Drive files you use with this app”.
        </p>
      )}
      {status.canRead && !status.picker && (
        <p className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs">
          Google&apos;s file picker isn&apos;t set up yet: add GOOGLE_PICKER_KEY and GOOGLE_PROJECT_NUMBER to .env.local.
        </p>
      )}

      {status.sheetId ? (
        <>
          <p className="flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-full bg-[var(--cat-2)]" aria-hidden />
            <a href={`https://docs.google.com/spreadsheets/d/${status.sheetId}`} target="_blank" rel="noreferrer" className="truncate underline underline-offset-2">
              {status.name ?? "Your sheet"}
            </a>
          </p>
          <p className="text-xs text-muted">{status.syncedAt ? `Checked ${ago(status.syncedAt, now)} · every minute` : "Not synced yet"}</p>
          <div className="flex flex-wrap gap-1">
            <button type="button" onClick={() => run("sync", { action: "sync" })} disabled={!!busy} className={`${button} border border-line hover:border-ink/40`}>
              {busy === "sync" ? "Syncing…" : "Sync now"}
            </button>
            <button type="button" onClick={choose} disabled={!!busy || !canChoose} className={`${button} text-muted hover:text-ink`}>
              Change sheet
            </button>
            <button type="button" onClick={disconnect} disabled={!!busy} className={`${button} text-muted hover:text-ink`} title="Stop syncing (events already made stay)">
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={choose} disabled={!!busy || !canChoose} className={`${button} bg-ink font-medium text-paper`}>
              {busy === "connect" ? "Connecting…" : "Choose a sheet"}
            </button>
            <button type="button" onClick={() => run("create", { action: "create" })} disabled={!!busy || !status.canRead} className={`${button} border border-line hover:border-ink/40`}>
              {busy === "create" ? "Creating…" : "Create a new one"}
            </button>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            One row per event: Title, Date, Start, End, Location, Notes (leave Start empty for all-day). Almanac can open only the sheet you choose or create here.
          </p>
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
