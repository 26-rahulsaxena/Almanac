import latest from "./android-build.json";

// Runs in the browser. The Almanac Android app is the live site inside an app; it adds "AlmanacAndroid/<n>" to its
// browser name. Sign-in goes through the phone's browser (Google refuses it inside apps): see src/lib/app-handoff.ts.

export const isAndroidApp = () => typeof navigator !== "undefined" && /AlmanacAndroid\//.test(navigator.userAgent);
const appVersion = () => Number(navigator.userAgent.match(/AlmanacAndroid\/(\d+)/)?.[1] ?? 0);
// What each app version can do (the "Almanac" plugin in android/.../AlmanacPlugin.java): 2 gets reminders,
// 3 has voice typing, 4 has the home-screen Agenda widget, 5 tells its build number, 6 opens links in the Gmail app.
export const appHasReminders = () => appVersion() >= 2;
export const appCanListen = () => appVersion() >= 3;
export const appHasWidget = () => appVersion() >= 4;
export const appOpensGmail = () => appVersion() >= 6;
// The newest app on the site (written by the Android build), and this phone's (0 = older than version 5, so
// older than any build that could say). An update is out when the site's is higher.
export const LATEST_BUILD = latest.build;
export const appBuild = async () => (appVersion() >= 5 ? (await (await almanacPlugin()).build()).build : 0);

type AlmanacPlugin = {
  status(): Promise<{ notifications: boolean; fullScreen: boolean }>;
  enable(): Promise<{ notifications: boolean; token?: string }>;
  token(): Promise<{ token?: string }>;
  openFullScreenSettings(): Promise<void>;
  listen(): Promise<{ text: string }>;
  setAgenda(o: { items: string }): Promise<void>;
  build(): Promise<{ build: number }>;
  openGmail(o: { url: string }): Promise<void>;
};
export async function almanacPlugin(): Promise<AlmanacPlugin> {
  const p = (await import("@capacitor/core")).registerPlugin<AlmanacPlugin>("Almanac");
  // The plugin answers to every name, even "then", so returning it as-is from here would never resolve.
  return {
    status: () => p.status(),
    enable: () => p.enable(),
    token: () => p.token(),
    openFullScreenSettings: () => p.openFullScreenSettings(),
    listen: () => p.listen(),
    setAgenda: (o) => p.setAgenda(o),
    build: () => p.build(),
    openGmail: (o) => p.openGmail(o),
  };
}

export type AgendaItem = { title: string; start: number; end: number; allDay: boolean; color: string };
// What the home-screen Agenda widget shows (saved on the phone only); [] empties it.
export async function saveAgenda(items: AgendaItem[]) {
  if (appHasWidget()) await (await almanacPlugin()).setAgenda({ items: JSON.stringify(items) });
}

const VERIFIER_KEY = "almanacAppVerifier";
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Opens Google sign-in in the phone's browser, with a challenge only this app can answer. gmail: also ask to read Gmail.
export async function startAppSignIn(gmail = false) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  localStorage.setItem(VERIFIER_KEY, verifier);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  const { Browser } = await import("@capacitor/browser");
  await Browser.open({ url: `${location.origin}/api/android/sign-in?c=${challenge}${gmail ? "&gmail=1" : ""}` });
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
