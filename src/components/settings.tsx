"use client";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { removeAccount, setDefaultCalendar, signOutNow, type AlertStages } from "@/app/actions";
import { GoogleSignIn, startLink } from "./google-sign-in";
import type { Account, LinkResult } from "@/lib/accounts";
import type { Cal } from "@/lib/calendar";
import { writableOptions } from "./event-panel";
import { Select } from "./select";
import { appBuild, isAndroidApp, LATEST_BUILD } from "@/lib/android-app";
import { AlertStageSettings, forgetDevice, NotifySettings } from "./notify-settings";
import { PlanModeSetting, type PlanMode } from "./suggestions";
import { LookSettings, ThemeMode } from "./theme-toggle";
import { HowItWorks } from "./tour";
import { MailSetting } from "./mail-finds";
import { useDialog } from "./use-dialog";
import { profileLine, type Profile } from "@/lib/profile";

const TABS = ["General", "Alerts", "Planning", "App", "Account"] as const;
type Tab = (typeof TABS)[number];

const KEYS: [string, string][] = [
  ["N", "New event"],
  ["K", "Ask Almanac"],
  ["P", "Priorities"],
  ["D W M A", "Day, week, month, agenda"],
  ["T", "Today"],
  ["← →", "Previous / next"],
  ["/", "Search"],
  ["\\", "Menu"],
];

// Every setting in one place, one section at a time, in a panel that slides in from the right (the menu drawer
// slides in from the left). Saved values come from the calendar page so they're still
// right when the window is opened again.
export function Settings(props: {
  name: string;
  email: string;
  onClose: () => void;
  stages: AlertStages;
  onStages: (s: AlertStages) => void;
  planMode: PlanMode;
  onPlanMode: (m: PlanMode) => void;
  mail: { gmail: boolean; on: boolean };
  onMail: (on: boolean) => void;
  profile: Profile | null;
  onEditProfile: () => void;
  accounts: Account[];
  linked?: LinkResult;
  calendars: Cal[];
  defaultCalendar?: string; // where new events go now
  onDefaultCalendar: (id: string) => void;
  onShareHelp: () => void;
  startTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(props.startTab ?? "General");
  const [tour, setTour] = useState(false);
  const ref = useDialog<HTMLElement>(props.onClose);
  const h3 = "font-mono text-xs uppercase tracking-[0.2em] text-muted";

  return (
    <>
      <motion.div className="fixed inset-0 z-40 bg-ink/25" onClick={props.onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-hidden />
      <motion.aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        initial={{ x: "105%" }}
        animate={{ x: 0 }}
        exit={{ x: "105%" }}
        transition={{ type: "spring", damping: 32, stiffness: 340 }}
        className="fixed inset-y-0 right-0 z-50 flex w-[min(26rem,92vw)] flex-col border-l border-line bg-paper pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-2xl"
      >
      <div className="flex items-center justify-between px-5 pb-4 pt-3">
        <h2 id="settings-title" className="font-serif text-2xl">
          Settings
        </h2>
        <button type="button" onClick={props.onClose} aria-label="Close settings" className="grid size-10 place-items-center rounded-full text-muted hover:bg-ink/5 hover:text-ink">
          ✕
        </button>
      </div>
      <div role="tablist" aria-label="Settings sections" className="mx-5 grid grid-cols-5 gap-0.5 rounded-full bg-ink/5 p-1">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`tab-${t}`}
            aria-selected={tab === t}
            aria-controls="settings-panel"
            onClick={() => setTab(t)}
            className={`min-w-0 rounded-full px-1 py-1.5 text-xs transition sm:text-sm ${tab === t ? "bg-surface font-medium shadow-sm" : "text-muted hover:text-ink"}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="settings-panel" aria-labelledby={`tab-${tab}`} className="mt-5 min-h-0 flex-1 overflow-y-auto px-5 pb-8">
        {tab === "General" && (
          <>
            <div className="mb-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className={h3}>How Almanac works</h3>
                  <p className="mt-1 text-sm">The main ideas on one page</p>
                </div>
                <button type="button" aria-expanded={tour} onClick={() => setTour(!tour)} className="shrink-0 rounded-full border border-line px-3 py-1.5 text-sm hover:border-ink/40">
                  {tour ? "Hide" : "Show"}
                </button>
              </div>
              {tour && (
                <div className="mt-4 rounded-2xl border border-line bg-surface p-4">
                  <HowItWorks />
                </div>
              )}
            </div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className={h3}>About you</h3>
                <p className="mt-1 text-sm">{profileLine(props.profile) || "Not set. Tell Almanac about your work so priorities fit it."}</p>
              </div>
              <button type="button" onClick={props.onEditProfile} className="shrink-0 rounded-full border border-line px-3 py-1.5 text-sm hover:border-ink/40">
                {profileLine(props.profile) ? "Edit" : "Set up"}
              </button>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className={h3}>Appearance</h3>
                <p className="mt-1 text-sm">Light, dark, or by time of day</p>
              </div>
              <ThemeMode />
            </div>
            <LookSettings />
            <h3 className={`${h3} mt-6`}>Keyboard</h3>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              {KEYS.map(([k, what]) => (
                <div key={k} className="contents">
                  <dt className="font-mono text-xs leading-5 text-muted">{k}</dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
        {tab === "Alerts" && (
          <>
            <h3 className={h3}>This device</h3>
            <NotifySettings />
            <AlertStageSettings initial={props.stages} onChange={props.onStages} />
          </>
        )}
        {tab === "Planning" && (
          <>
            <h3 className={h3}>Planning mode</h3>
            <PlanModeSetting initial={props.planMode} onChange={props.onPlanMode} />
            <h3 className={`${h3} mt-6`}>Read my email</h3>
            <MailSetting gmail={props.mail.gmail} on={props.mail.on} onChange={props.onMail} accounts={props.accounts} />
          </>
        )}
        {tab === "App" && (
          <>
            <h3 className={h3}>Almanac for Android</h3>
            {isAndroidApp() ? (
              <AppUpdate />
            ) : (
              <>
                <p className="mt-2 text-sm">
                  A real app for your Android phone: reminders arrive even when it&rsquo;s closed, and when an event starts it rings full
                  screen, like an alarm clock. Test version, not on the Play Store.
                </p>
                <a href="/download" className="mt-4 inline-block rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper">
                  Download the app
                </a>
                <p className="mt-3 text-xs text-muted">
                  Open this on the Android phone itself. On iPhone: open Almanac in Safari, then Share → Add to Home Screen.
                </p>
              </>
            )}
          </>
        )}
        {tab === "Account" && (
          <>
            <h3 className={h3}>Signed in as</h3>
            <div className="mt-3 flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-sm font-medium uppercase text-paper" aria-hidden>
                {(props.name || props.email)[0]}
              </span>
              <div className="min-w-0">
                {props.name && <p className="truncate text-sm font-medium">{props.name}</p>}
                <p className="truncate text-sm text-muted">{props.email}</p>
              </div>
            </div>
            <h3 className={`${h3} mt-6`}>Google accounts</h3>
            <p className="mt-1 text-sm">Calendars from all of them show together in Almanac, and you can change their events here.</p>
            <GoogleAccounts accounts={props.accounts} linked={props.linked} />
            <button type="button" onClick={props.onShareHelp} className="mt-2 text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
              Can&rsquo;t add one? Share a single calendar instead
            </button>
            <h3 className={`${h3} mt-6`}>New events go to</h3>
            <p className="mt-1 text-sm">Also where Almanac adds to-dos and planned time. You can pick another calendar on each new event.</p>
            <Select
              aria-label="New events go to"
              fit
              value={props.defaultCalendar ?? ""}
              placeholder="No calendar you can add to"
              onChange={(id) => {
                props.onDefaultCalendar(id);
                setDefaultCalendar(id).catch(() => {});
              }}
              className="mt-3 w-full rounded-xl border border-line bg-surface px-3 py-2 text-left text-sm"
              options={writableOptions(props.calendars)}
            />
            <p className="mt-6 text-sm">Signing out stops notifications on this device. Signing in with any of the accounts above opens this same Almanac.</p>
            {/* This device stops getting the account's notifications before the session ends; a slow phone or
                network never holds up signing out for more than 3 seconds. */}
            <form action={async () => { await Promise.race([forgetDevice(), new Promise((r) => setTimeout(r, 3000))]); await signOutNow(); }} className="mt-4">
              <button type="submit" className="w-full whitespace-nowrap rounded-full border border-line px-4 py-2 text-sm font-medium hover:border-ink/40">
                Sign out
              </button>
            </form>
          </>
        )}
      </div>
      </motion.aside>
    </>
  );
}

// Inside the Android app: is this the newest version, and a button that downloads it in the phone's browser
// (it installs over this one; you stay signed in). Phones are also notified when a new one is out (see the cron).
function AppUpdate() {
  const [build, setBuild] = useState<number | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    appBuild().then(setBuild, () => setBuild(0));
  }, []);
  if (build === null) return <p className="mt-2 text-sm text-muted">Checking for updates…</p>;
  const behind = build ? build < LATEST_BUILD : LATEST_BUILD > 14; // 14: the last build that can't tell its number
  async function download() {
    setError(false);
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: `${location.origin}/almanac.apk` });
    } catch {
      setError(true);
    }
  }
  return (
    <>
      <p className="mt-2 flex items-center gap-2 text-sm">
        <span className={`size-2 rounded-full ${behind ? "bg-accent" : "bg-[var(--cat-2)]"}`} aria-hidden />
        {behind ? "A new version is ready" : "You have the latest version"}
      </p>
      <p className="mt-1 text-xs text-muted">
        {build || !behind ? `This phone: version ${build || LATEST_BUILD}` : "This phone: an older version"}
        {behind && ` · Newest: version ${LATEST_BUILD}`}
      </p>
      <button
        type="button"
        onClick={download}
        className={`mt-4 rounded-full px-4 py-2 text-sm font-medium ${behind ? "bg-ink text-paper" : "border border-line hover:border-ink/40"}`}
      >
        {behind ? "Download the new version" : "Download again"}
      </button>
      <p className="mt-3 text-xs text-muted">
        It downloads in your browser. Open the file to install; it updates in place and you stay signed in. When a new
        version is out, you&rsquo;ll get a notification.
      </p>
      {error && <p className="mt-2 text-sm text-[var(--cat-1)]">Couldn&rsquo;t open the download. Go to almanac-tau-orcin.vercel.app/download instead.</p>}
    </>
  );
}

const LINKED: Record<LinkResult, string> = {
  added: "Account added. Its calendars are in the menu now.",
  moved: "Account added. It had its own Almanac before; signing in with it now opens this one.",
  again: "Done. That account is connected again, with what you just allowed.",
  main: "That's the account you sign in with, so there was nothing to add.",
  error: "That didn't work. Try Add again.",
};

// The connected Google accounts: Add (Google's account chooser; in the Android app, in the phone's browser, and the
// app reloads once that's closed), Reconnect for one Google stopped accepting, Allow Tasks for one whose Google Tasks
// Almanac can't read yet, Remove for any but the main one.
function GoogleAccounts({ accounts, linked }: { accounts: Account[]; linked?: LinkResult }) {
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function add() {
    setBusy(true);
    setError(false);
    try {
      await startLink();
    } catch {
      setError(true);
    }
    setBusy(false);
  }
  async function remove(id: string) {
    setBusy(true);
    try {
      await removeAccount(id);
      location.reload(); // the calendars come from the server
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <>
      {linked && LINKED[linked] && <p className="mt-3 rounded-xl bg-accent/10 px-3 py-2 text-sm">{LINKED[linked]}</p>}
      <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-surface">
        {accounts.map((a) => (
          <li key={a.id} className="px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{a.email}</p>
                <p className={`text-xs ${a.broken ? "text-accent" : "text-muted"}`}>
                  {a.main ? "Main · you sign in with this one" : a.broken ? "Google stopped letting Almanac in. Reconnect to see its calendars again." : "Added"}
                </p>
              </div>
              {a.broken && (
                <button type="button" disabled={busy} onClick={add} className="shrink-0 rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60">
                  Reconnect
                </button>
              )}
              {!a.main && removing !== a.id && (
                <button type="button" disabled={busy} onClick={() => setRemoving(a.id)} className="shrink-0 rounded-full border border-line px-3 py-1.5 text-sm hover:border-ink/40 disabled:opacity-60">
                  Remove
                </button>
              )}
            </div>
            {/* Signed in before Tasks were asked for, or unticked on Google's screen: Google asks again for this account. */}
            {!a.broken && !a.tasks && (
              <div className="mt-2 flex items-center gap-3 text-xs text-muted">
                <span className="min-w-0 flex-1">Its Google Tasks aren&rsquo;t shown yet.</span>
                {a.main ? (
                  <GoogleSignIn className="shrink-0">
                    <button type="submit" className="rounded-full border border-line px-3 py-1 text-xs text-ink hover:border-ink/40">
                      Allow Tasks
                    </button>
                  </GoogleSignIn>
                ) : (
                  <button type="button" disabled={busy} onClick={add} className="shrink-0 rounded-full border border-line px-3 py-1 text-xs text-ink hover:border-ink/40 disabled:opacity-60">
                    Allow Tasks
                  </button>
                )}
              </div>
            )}
            {removing === a.id && (
              <div className="mt-2 rounded-xl bg-ink/5 p-3 text-sm">
                <p>Its calendars leave Almanac. Nothing is deleted in Google.</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={busy} onClick={() => remove(a.id)} className="rounded-full bg-ink px-3 py-1.5 text-paper disabled:opacity-60">
                    Remove
                  </button>
                  <button type="button" onClick={() => setRemoving(null)} className="rounded-full border border-line px-3 py-1.5 hover:border-ink/40">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      <button type="button" disabled={busy} onClick={add} className="mt-3 w-full rounded-full border border-line px-4 py-2 text-sm font-medium hover:border-ink/40 disabled:opacity-60">
        + Add another Google account
      </button>
      {error && <p className="mt-2 text-sm text-[var(--cat-1)]">Something went wrong. Try again.</p>}
    </>
  );
}
