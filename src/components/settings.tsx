"use client";
import { useState } from "react";
import type { AlertStages } from "@/app/actions";
import { Modal } from "./coach";
import { AlertStageSettings, NotifySettings } from "./notify-settings";
import { SheetSync } from "./sheet-sync";
import { PlanModeSetting, type PlanMode } from "./suggestions";
import { ThemeToggle } from "./theme-toggle";

const TABS = ["General", "Alerts", "Planning", "Sheet"] as const;
type Tab = (typeof TABS)[number];

const KEYS: [string, string][] = [
  ["N", "New event or to-do"],
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
  onClose: () => void;
  stages: AlertStages;
  onStages: (s: AlertStages) => void;
  planMode: PlanMode;
  onPlanMode: (m: PlanMode) => void;
  now: Date;
  onCalendarChange: () => void;
}) {
  const [tab, setTab] = useState<Tab>("General");
  const h3 = "font-mono text-xs uppercase tracking-[0.2em] text-muted";

  return (
    <Modal title="Settings" onClose={props.onClose}>
      <div role="tablist" aria-label="Settings sections" className="grid grid-cols-4 gap-1 rounded-full bg-ink/5 p-1">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`tab-${t}`}
            aria-selected={tab === t}
            aria-controls="settings-panel"
            onClick={() => setTab(t)}
            className={`rounded-full px-2 py-1.5 text-sm transition ${tab === t ? "bg-surface font-medium shadow-sm" : "text-muted hover:text-ink"}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="settings-panel" aria-labelledby={`tab-${tab}`} className="mt-5 min-h-[22rem]">
        {tab === "General" && (
          <>
            <div className="flex items-center justify-between gap-3">
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
        {tab === "Sheet" && (
          <>
            <h3 className={h3}>Google Sheet</h3>
            <SheetSync now={props.now} onCalendarChange={props.onCalendarChange} />
          </>
        )}
      </div>
    </Modal>
  );
}
