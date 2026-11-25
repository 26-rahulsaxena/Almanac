"use client";
import { MotionConfig } from "motion/react";
import { useEffect } from "react";
import { paintSky } from "./theme-toggle";

const BUILD = process.env.ALMANAC_BUILD;

// Coming back to a page that was left open (the Android app keeps it running in the background): if a newer
// version is live, reload to get it. Never while a pop-up or form is open, so nothing typed is lost.
async function reloadIfOutdated() {
  if (BUILD === "dev" || document.visibilityState !== "visible" || document.querySelector('[role="dialog"]')) return;
  const live = await fetch("/api/version", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (live?.build && live.build !== BUILD) location.reload();
}

// reducedMotion="user" turns off movement animations when the OS "reduce motion" setting is on.
export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.addEventListener("visibilitychange", reloadIfOutdated);
    window.addEventListener("focus", reloadIfOutdated);
    // Sky look: its glow follows the sky, each minute and on coming back.
    paintSky();
    const sky = setInterval(paintSky, 60_000);
    document.addEventListener("visibilitychange", paintSky);
    return () => {
      document.removeEventListener("visibilitychange", reloadIfOutdated);
      window.removeEventListener("focus", reloadIfOutdated);
      clearInterval(sky);
      document.removeEventListener("visibilitychange", paintSky);
    };
  }, []);
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
