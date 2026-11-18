"use client";
import { useEffect, type ReactNode } from "react";
import { allowGmail, connectGmail, linkUrl, setMailOn, signInWithGoogle } from "@/app/actions";
import { isAndroidApp, listenForAppSignIn, startAppSignIn } from "@/lib/android-app";

// The "Continue with Google" form. On the website it's the normal sign-in; in the Android app it signs in through
// the phone's browser instead. gmail: also ask for Gmail and switch on "Read my email" (Settings); "allow": only ask
// for Gmail (the inbox's Allow). children: the submit button.
export function GoogleSignIn({ children, className, gmail = false }: { children: ReactNode; className?: string; gmail?: boolean | "allow" }) {
  useEffect(() => (isAndroidApp() ? listenForAppSignIn() : undefined), []);
  return (
    <form
      action={gmail === "allow" ? allowGmail : gmail ? connectGmail : signInWithGoogle}
      className={className}
      onSubmit={async (e) => {
        if (!isAndroidApp()) return;
        e.preventDefault();
        if (gmail === true) await setMailOn(true);
        startAppSignIn(!!gmail);
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
