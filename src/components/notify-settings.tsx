"use client";
import { useEffect, useState } from "react";

type State = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on";

// The public half of the push key pair, as the bytes browsers expect.
const vapidKey = (b64: string) =>
  Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));

const post = (method: "POST" | "DELETE", body: object) =>
  fetch("/api/push", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// Switches reminder notifications on or off for this browser / phone.
export function NotifySettings() {
  const [state, setState] = useState<State>("loading");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        // iPhone only offers push to apps added to the Home Screen.
        const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent) && !matchMedia("(display-mode: standalone)").matches;
        return setState(iphone ? "ios-install" : "unsupported");
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      if (Notification.permission === "denied") return setState("denied");
      setState((await reg.pushManager.getSubscription()) ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function enable() {
    setMsg(null);
    try {
      // Ask first, straight from the tap: iPhone refuses the prompt otherwise.
      if ((await Notification.requestPermission()) !== "granted") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!) });
      if (!(await post("POST", sub.toJSON())).ok) throw new Error();
      setState("on");
    } catch {
      setMsg("Couldn't switch on notifications here. Try again, or use Chrome or Edge.");
    }
  }

  async function disable() {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (sub) {
      await post("DELETE", { endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
    setState("off");
  }

  async function test() {
    setMsg("Sending…");
    const { devices } = await (await post("POST", { test: true })).json();
    setMsg(devices ? `Sent to ${devices} device${devices === 1 ? "" : "s"}. It should pop up in a few seconds.` : "No device received it. Turn notifications off and on again.");
  }

  const button = "rounded-full px-3 py-1.5 text-sm";
  return (
    <div className="mt-3 space-y-2 text-sm">
      {state === "on" && (
        <>
          <p className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-[var(--cat-2)]" aria-hidden /> On for this device
          </p>
          <div className="flex flex-wrap gap-1">
            <button type="button" onClick={test} className={`${button} border border-line hover:border-ink/40`}>
              Send a test
            </button>
            <button type="button" onClick={disable} className={`${button} text-muted hover:text-ink`}>
              Turn off
            </button>
          </div>
        </>
      )}
      {state === "off" && (
        <button type="button" onClick={enable} className={`${button} bg-ink font-medium text-paper`}>
          Turn on notifications
        </button>
      )}
      {state === "denied" && <p className="text-muted">Notifications are blocked for this site. Allow them in the browser&apos;s site settings, then reload.</p>}
      {state === "ios-install" && (
        <p className="text-muted">On iPhone: tap Share, then “Add to Home Screen”. Open Almanac from the Home Screen and turn notifications on there.</p>
      )}
      {state === "unsupported" && <p className="text-muted">This browser can&apos;t receive notifications.</p>}
      {msg && <p className="text-xs text-muted">{msg}</p>}
    </div>
  );
}
