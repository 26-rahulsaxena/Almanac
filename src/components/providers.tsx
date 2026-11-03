"use client";
import { MotionConfig } from "motion/react";

// reducedMotion="user" turns off movement animations when the OS "reduce motion" setting is on.
export function Providers({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
