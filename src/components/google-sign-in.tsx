"use client";
import { useEffect, type ReactNode } from "react";
import { signInWithGoogle } from "@/app/actions";
import { isAndroidApp, listenForAppSignIn, startAppSignIn } from "@/lib/android-app";

// The "Continue with Google" form. On the website it's the normal sign-in; in the Android app it signs in through
// the phone's browser instead. children: the submit button.
export function GoogleSignIn({ children, className }: { children: ReactNode; className?: string }) {
  useEffect(() => (isAndroidApp() ? listenForAppSignIn() : undefined), []);
  return (
    <form
      action={signInWithGoogle}
      className={className}
      onSubmit={(e) => {
        if (!isAndroidApp()) return;
        e.preventDefault();
        startAppSignIn();
      }}
    >
      {children}
    </form>
  );
}
