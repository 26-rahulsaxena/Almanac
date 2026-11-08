// Runs in the browser. The Almanac Android app is the live site inside an app; it adds "AlmanacAndroid/<n>" to its
// browser name. Sign-in goes through the phone's browser (Google refuses it inside apps): see src/lib/app-handoff.ts.

export const isAndroidApp = () => typeof navigator !== "undefined" && /AlmanacAndroid\//.test(navigator.userAgent);
// Version 2 and later can get reminders (the "Almanac" plugin in android/.../AlmanacPlugin.java).
export const appHasReminders = () => Number(navigator.userAgent.match(/AlmanacAndroid\/(\d+)/)?.[1] ?? 0) >= 2;

type AlmanacPlugin = {
  status(): Promise<{ notifications: boolean; fullScreen: boolean }>;
  enable(): Promise<{ notifications: boolean; token?: string }>;
  token(): Promise<{ token?: string }>;
  openFullScreenSettings(): Promise<void>;
};
export const almanacPlugin = async () => (await import("@capacitor/core")).registerPlugin<AlmanacPlugin>("Almanac");

const VERIFIER_KEY = "almanacAppVerifier";
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Opens Google sign-in in the phone's browser, with a challenge only this app can answer.
export async function startAppSignIn() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  localStorage.setItem(VERIFIER_KEY, verifier);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url: `${location.origin}/api/android/sign-in?c=${challenge}` });
}

// Waits for the browser to hand back (almanac://signed-in?code=...), whether the app was open or had been closed,
// then swaps the code for the session. Returns a function that stops listening.
export function listenForAppSignIn() {
  let stop = () => {};
  import("@capacitor/app").then(async ({ App }) => {
    async function handle(url?: string) {
      const verifier = localStorage.getItem(VERIFIER_KEY);
      // No verifier: no sign-in in progress (or this link was already used, e.g. the page reloaded after it).
      if (!url?.startsWith("almanac://signed-in") || !verifier) return;
      localStorage.removeItem(VERIFIER_KEY);
      const code = new URL(url).searchParams.get("code");
      const r = await fetch("/api/android/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, verifier }) }).catch(() => null);
      location.replace(r?.ok ? "/" : "/?error=AppSignIn");
    }
    const sub = await App.addListener("appUrlOpen", (e) => handle(e.url));
    stop = () => sub.remove();
    handle((await App.getLaunchUrl())?.url);
  });
  return () => stop();
}
