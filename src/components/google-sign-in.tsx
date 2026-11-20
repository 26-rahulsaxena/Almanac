"use client";
import { useEffect, type ReactNode } from "react";
import { connectGmail, linkUrl, setMailOn, signInWithGoogle } from "@/app/actions";
import { isAndroidApp, listenForAppSignIn, startAppSignIn } from "@/lib/android-app";

// The "Continue with Google" form. On the website it's the normal sign-in; in the Android app it signs in through
// the phone's browser instead. gmail: also ask to read Gmail (Settings → "Read my email"). children: the submit button.
export function GoogleSignIn({ children, className, gmail = false }: { children: ReactNode; className?: string; gmail?: boolean }) {
  useEffect(() => (isAndroidApp() ? listenForAppSignIn() : undefined), []);
  return (
    <form
      action={gmail ? connectGmail : signInWithGoogle}
      className={className}
      onSubmit={async (e) => {
        if (!isAndroidApp()) return;
        e.preventDefault();
        if (gmail) await setMailOn(true);
        startAppSignIn(gmail);
      }}
    >
      {children}
    </form>
  );
}

// Adding (or reconnecting) another Google account: Google's account chooser, on the website in this tab; in the
// Android app in the phone's browser, and the app reloads once that's closed. gmail: also ask to read its Gmail.
export async function startLink(gmail = false) {
  const url = await linkUrl(isAndroidApp(), gmail);
  if (!isAndroidApp()) return location.assign(url);
  const { Browser } = await import("@capacitor/browser");
  await Browser.addListener("browserFinished", () => location.reload());
  await Browser.open({ url: location.origin + url });
}
