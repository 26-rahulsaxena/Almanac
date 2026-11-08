"use client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { enablePush, PUSH_HELP, usePushState } from "./notify-settings";

const LATER_KEY = "alertsBannerUntil";
const DAY = 86_400_000;

// The browser's "install this app" offer (Chrome and Edge; not in TypeScript's types yet).
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

// A bar at the top while this device can't get reminders when Almanac is closed, with a one-tap fix. Once alerts
// are on, phones that can install Almanac as an app are offered that too (more reliable reminders). "Not now"
// hides it for a day.
export function AlertsBanner() {
  const state = usePushState();
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  const [later, setLater] = useState(() => {
    try {
      return Date.now() < Number(localStorage.getItem(LATER_KEY));
    } catch {
      return false;
    }
  });
  const [error, setError] = useState(false);

  useEffect(() => {
    const offer = (e: Event) => {
      e.preventDefault(); // keep the offer for our button instead of the browser's own mini bar
      setInstall(e as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", offer);
    return () => window.removeEventListener("beforeinstallprompt", offer);
  }, []);

  function notNow() {
    setLater(true);
    try {
      localStorage.setItem(LATER_KEY, String(Date.now() + DAY));
    } catch {}
  }
  async function turnOn() {
    setError(false);
    await enablePush().catch(() => setError(true));
  }
  async function installApp() {
    await install?.prompt();
    setInstall(null);
  }

  const phone = typeof window !== "undefined" && matchMedia("(pointer: coarse)").matches;
  const text = state && state !== "on" ? PUSH_HELP[state] : install && phone ? "Install Almanac on this phone for more reliable reminders." : null;
  const action = state === "off" ? { label: "Turn on", run: turnOn } : state === "on" && install ? { label: "Install", run: installApp } : null;

  return (
    <AnimatePresence initial={false}>
      {text && !later && (
        <motion.div
          role="status"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="overflow-hidden"
        >
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-accent/40 bg-accent/10 px-4 py-2.5 text-sm">
            <span className="min-w-0 flex-1">
              {text}
              {error && <span className="block text-xs text-muted">Couldn&rsquo;t switch them on here. Try again, or use Chrome or Edge.</span>}
            </span>
            <span className="flex shrink-0 gap-1">
              {action && (
                <button type="button" onClick={action.run} className="rounded-full bg-ink px-3 py-1 text-sm font-medium text-paper">
                  {action.label}
                </button>
              )}
              <button type="button" onClick={notNow} className="rounded-full px-2 py-1 text-sm text-muted hover:text-ink">
                Not now
              </button>
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
