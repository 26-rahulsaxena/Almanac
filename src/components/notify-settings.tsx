"use client";
import { useEffect, useState } from "react";
import { setAlertStages, type AlertStages } from "@/app/actions";
import { almanacPlugin, appHasReminders, isAndroidApp } from "@/lib/android-app";
import { SNOOZE_CHOICES } from "@/lib/reminders";

// Whether this device gets reminders when Almanac is closed:
// on · off (not asked yet, or turned off) · denied (blocked in the browser) · ios-install (iPhone: add to Home Screen
// first) · unsupported (this browser can't).
export type PushState = "unsupported" | "ios-install" | "denied" | "off" | "on";
// Fired when this device's state changes, so the banner, the welcome pop-up and Settings stay in step.
const PUSH_EVENT = "almanac-push";
const changed = () => window.dispatchEvent(new Event(PUSH_EVENT));

// The public half of the push key pair, as the bytes browsers expect.
const vapidKey = (b64: string) =>
  Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));

const post = (method: "POST" | "DELETE", body: object) =>
  fetch("/api/push", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const currentSub = async () => (await navigator.serviceWorker?.getRegistration())?.pushManager.getSubscription();
const installed = () => matchMedia("(display-mode: standalone)").matches;

// "Chrome on Windows", "Safari on iPhone (app)": how this device is listed in Settings.
export function deviceName() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return `${browser}${os ? ` on ${os}` : ""}${installed() ? " (app)" : ""}`;
}

export async function pushState(): Promise<PushState> {
  if (isAndroidApp()) {
    // The app gets reminders through Firebase, not the browser, and signs itself up each time it opens
    // (android/.../Notify.register), so allowed notifications mean it's on. The first app version can't: it needs updating.
    if (!appHasReminders()) return "unsupported";
    return (await (await almanacPlugin()).status()).notifications ? "on" : "off";
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    // iPhone only offers push to apps added to the Home Screen.
    return /iPhone|iPad|iPod/.test(navigator.userAgent) && !installed() ? "ios-install" : "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.register("/sw.js");
  return Notification.permission === "granted" && (await reg.pushManager.getSubscription()) ? "on" : "off";
}

// Asks for permission and signs this device up. Must run straight from a tap: iPhone refuses the prompt otherwise.
// The Android app: asks for permission, then saves this phone's Firebase token.
async function enableAppPush(): Promise<PushState> {
  const { notifications, token } = await (await almanacPlugin()).enable();
  if (notifications && token) {
    if (!(await post("POST", { fcm: token, device: "Almanac app on Android" })).ok) throw new Error("Couldn't save this device");
  }
  changed();
  return notifications && token ? "on" : "off";
}

export async function enablePush(): Promise<PushState> {
  if (isAndroidApp()) return enableAppPush();
  const answer = await Notification.requestPermission();
  if (answer !== "granted") {
    changed();
    return answer === "denied" ? "denied" : "off";
  }
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!) });
  if (!(await post("POST", { ...sub.toJSON(), device: deviceName() })).ok) throw new Error("Couldn't save this device");
  changed();
  return "on";
}

async function disablePush() {
  const sub = await currentSub();
  if (sub) {
    await post("DELETE", { endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
  changed();
}

// This device's state, kept up to date when it changes anywhere in the app. null while checking.
export function usePushState() {
  const [state, setState] = useState<PushState | null>(null);
  useEffect(() => {
    const check = () => pushState().then(setState, () => setState("unsupported"));
    check();
    window.addEventListener(PUSH_EVENT, check);
    return () => window.removeEventListener(PUSH_EVENT, check);
  }, []);
  return state;
}

// On app open: if this browser has notifications on, tell the server again, so it belongs to whoever is signed in
// now and comes back if the server dropped it. Never switches notifications on by itself.
export async function syncPush() {
  if (isAndroidApp()) {
    // Only when already allowed, so opening the app never pops up a permission question by itself.
    if (appHasReminders() && (await (await almanacPlugin()).status()).notifications) await enableAppPush().catch(() => {});
    return;
  }
  const sub = await currentSub().catch(() => null);
  if (sub && Notification.permission === "granted") await post("POST", { ...sub.toJSON(), device: deviceName() }).catch(() => {});
}

// On sign out: this device stops getting the account's notifications (it stays switched on in the browser,
// so it picks up the next account that signs in here).
export async function forgetDevice() {
  if (isAndroidApp()) {
    const token = appHasReminders() ? await almanacPlugin().then((p) => p.token()).then((r) => r.token, () => undefined) : undefined;
    if (token) await post("DELETE", { endpoint: `fcm:${token}` }).catch(() => {});
    return;
  }
  const sub = await currentSub().catch(() => null);
  if (sub) await post("DELETE", { endpoint: sub.endpoint }).catch(() => {});
}

// What to tell someone whose device can't get reminders yet, for each state.
export const PUSH_HELP: Record<Exclude<PushState, "on">, string> = {
  off: "You won't get reminders on this device when Almanac is closed.",
  denied: "Notifications are blocked for Almanac in this browser. Allow them in the site settings (the icon left of the address bar), then reload.",
  "ios-install": "To get reminders on iPhone, add Almanac to your Home Screen: tap Share, then “Add to Home Screen”, and open it from there.",
  get unsupported() {
    return isAndroidApp()
      ? "This version of the app can't get reminders. Install the new version from almanac-tau-orcin.vercel.app/download."
      : "This browser can't show reminders. Use Chrome, Edge or Safari.";
  },
};

// Switches reminder notifications on or off for this browser / phone, and lists the other devices that get them.
export function NotifySettings() {
  const state = usePushState();
  const [msg, setMsg] = useState<string | null>(null);

  async function enable() {
    setMsg(null);
    try {
      await enablePush();
    } catch {
      setMsg("Couldn't switch on notifications here. Try again, or use Chrome or Edge.");
    }
  }

  const button = "rounded-full px-3 py-1.5 text-sm";
  return (
    <div className="mt-3 space-y-2 text-sm">
      {state === "on" && (
        <>
          <p className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-[var(--cat-2)]" aria-hidden /> On for this device
          </p>
          {isAndroidApp() ? (
            <>
              <p className="text-xs text-muted">To stop them, turn off notifications for Almanac in your phone&rsquo;s settings.</p>
              <FullScreenSetting />
            </>
          ) : (
            <button type="button" onClick={() => disablePush()} className={`${button} text-muted hover:text-ink`}>
              Turn off on this device
            </button>
          )}
        </>
      )}
      {state === "off" && (
        <button type="button" onClick={enable} className={`${button} bg-ink font-medium text-paper`}>
          Turn on notifications
        </button>
      )}
      {state && state !== "on" && state !== "off" && <p className="text-muted">{PUSH_HELP[state]}</p>}
      {msg && <p className="text-xs text-muted">{msg}</p>}
      <DeviceList key={state ?? ""} />
    </div>
  );
}

// Android 14+ lets each app show alarms full screen only if allowed in the phone's settings. Without it the alarm
// still rings, as a pop-up at the top of the screen.
function FullScreenSetting() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    const check = () => almanacPlugin().then((p) => p.status()).then((s) => setAllowed(s.fullScreen), () => setAllowed(null));
    check();
    window.addEventListener("focus", check); // back from the phone's settings
    return () => window.removeEventListener("focus", check);
  }, []);
  if (allowed !== false) return null;
  return (
    <div className="rounded-xl border border-accent/40 bg-accent/10 p-3">
      <p>Allow full-screen alarms, so an event starting shows over your lock screen like an alarm clock.</p>
      <button type="button" onClick={() => almanacPlugin().then((p) => p.openFullScreenSettings())} className="mt-2 rounded-full bg-ink px-3 py-1.5 text-sm font-medium text-paper">
        Allow
      </button>
    </div>
  );
}

type Device = { id: string; device: string | null; addedAt: string; seenAt: string };
const ago = (iso: string) => {
  const days = Math.floor((Date.now() - +new Date(iso)) / 86_400_000);
  return days < 1 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
};

// Every device that gets your reminders, with a test for each, so you can check them all from one place.
function DeviceList() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/push")
      .then((r) => (r.ok ? r.json() : []))
      .then(setDevices, () => setDevices([]));
  }, []);

  async function test(id: string) {
    setNote((n) => ({ ...n, [id]: "Sending…" }));
    const { devices: reached } = await (await post("POST", { test: true, id })).json().catch(() => ({ devices: 0 }));
    setNote((n) => ({ ...n, [id]: reached ? "Sent. It should pop up in a few seconds." : "Didn't reach it. Open Almanac on that device and turn notifications on again." }));
  }
  async function remove(id: string) {
    await post("DELETE", { id });
    setDevices((d) => d?.filter((x) => x.id !== id) ?? null);
  }

  if (!devices) return null;
  return (
    <div className="pt-3">
      <h4 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Your devices</h4>
      {devices.length === 0 ? (
        <p className="mt-1 text-muted">None yet. Turn notifications on here and on your phone, so reminders reach you when Almanac is closed.</p>
      ) : (
        <ul className="mt-1 divide-y divide-line">
          {devices.map((d) => (
            <li key={d.id} className="py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate">{d.device ?? "A device"}</span>
                  <span className="block text-xs text-muted">Last opened {ago(d.seenAt)}</span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <button type="button" onClick={() => test(d.id)} className="rounded-full border border-line px-3 py-1 text-xs hover:border-ink/40">
                    Test
                  </button>
                  <button type="button" onClick={() => remove(d.id)} className="rounded-full px-2 py-1 text-xs text-muted hover:text-ink">
                    Remove
                  </button>
                </span>
              </div>
              {note[d.id] && <p className="mt-1 text-xs text-muted">{note[d.id]}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The three alert stages for every event, saved to the account (they apply on every device).
export function AlertStageSettings({ initial, onChange }: { initial: AlertStages; onChange: (s: AlertStages) => void }) {
  const [s, setS] = useState(initial);
  const [error, setError] = useState(false);

  function change(next: AlertStages) {
    const before = s;
    setS(next);
    setError(false);
    setAlertStages(next).then(
      () => onChange(next),
      () => {
        setS(before);
        setError(true);
      },
    );
  }

  return (
    <fieldset className="mt-6 space-y-2.5 text-sm">
      <legend className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-muted">Alerts for each event</legend>
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={s.remind} onChange={(e) => change({ ...s, remind: e.target.checked })} />
        <span>
          <b className="font-medium">1. At the reminder time</b>
          <span className="block text-xs text-muted">A pop-up with a soft chime, at each reminder set on the event.</span>
        </span>
      </label>
      <div className="flex items-start gap-2 pl-5">
        <span>
          <b className="font-medium">2. Again after </b>
          <select
            aria-label="Snooze length in minutes"
            value={s.snooze}
            onChange={(e) => change({ ...s, snooze: +e.target.value })}
            className="rounded-md border border-line bg-paper px-1 py-0.5"
          >
            {SNOOZE_CHOICES.map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
          <span className="block text-xs text-muted">If you snooze it or don&apos;t answer it. Not after the event has started.</span>
        </span>
      </div>
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={s.alarm} onChange={(e) => change({ ...s, alarm: e.target.checked })} />
        <span>
          <b className="font-medium">3. When it starts</b>
          <span className="block text-xs text-muted">Full screen with an alarm, until you answer it. Not for all-day events.</span>
        </span>
      </label>
      {error && <p className="text-xs text-accent">Couldn&apos;t save. Try again.</p>}
    </fieldset>
  );
}
