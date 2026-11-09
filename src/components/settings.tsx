"use client";
import { useState } from "react";
import { signOutNow, type AlertStages } from "@/app/actions";
import { isAndroidApp } from "@/lib/android-app";
import { Modal } from "./coach";
import { AlertStageSettings, forgetDevice, NotifySettings } from "./notify-settings";
import { PlanModeSetting, type PlanMode } from "./suggestions";
import { ThemeToggle } from "./theme-toggle";
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

// Every setting in one place, one section at a time. Saved values come from the calendar page so they're still
// right when the window is opened again.
export function Settings(props: {
  name: string;
  email: string;
  onClose: () => void;
  stages: AlertStages;
  onStages: (s: AlertStages) => void;
  planMode: PlanMode;
  onPlanMode: (m: PlanMode) => void;
  profile: Profile | null;
  onEditProfile: () => void;
}) {
  const [tab, setTab] = useState<Tab>("General");
  const h3 = "font-mono text-xs uppercase tracking-[0.2em] text-muted";

  return (
    <Modal title="Settings" onClose={props.onClose}>
      <div role="tablist" aria-label="Settings sections" className="grid grid-cols-5 gap-0.5 rounded-full bg-ink/5 p-1">
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

      <div role="tabpanel" id="settings-panel" aria-labelledby={`tab-${tab}`} className="-mx-1 mt-5 h-[min(24rem,calc(100dvh-13rem))] overflow-y-auto px-1">
        {tab === "General" && (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className={h3}>About you</h3>
                <p className="mt-1 text-sm">{profileLine(props.profile) || "Not set. Tell Almanac about your work so priorities fit it."}</p>
              </div>
              <button type="button" onClick={props.onEditProfile} className="shrink-0 rounded-full border border-line px-3 py-1.5 text-sm hover:border-ink/40">
                {profileLine(props.profile) ? "Edit" : "Set up"}
              </button>
            </div>
            <div className="mt-6 flex items-center justify-between gap-3">
              <div>
                <h3 className={h3}>Appearance</h3>
                <p className="mt-1 text-sm">Light or dark</p>
              </div>
              <ThemeToggle />
            </div>
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
          </>
        )}
        {tab === "App" && (
          <>
            <h3 className={h3}>Almanac for Android</h3>
            {isAndroidApp() ? (
              <p className="mt-2 text-sm">
                You&rsquo;re using the app. When a new version is out, install it from the{" "}
                <a href="/download" className="underline">download page</a>; it updates in place and you stay signed in.
              </p>
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
            <p className="mt-6 text-sm">Signing out stops notifications on this device. To use another Google account, sign out, then sign in with it.</p>
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
    </Modal>
  );
}
