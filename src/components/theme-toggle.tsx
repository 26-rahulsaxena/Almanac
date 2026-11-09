"use client";
import { motion } from "motion/react";

export function ThemeToggle() {
  function apply() {
    const dark = document.documentElement.classList.toggle("dark");
    try {
      localStorage.theme = dark ? "dark" : "light";
    } catch {}
  }

  // The new theme spreads from this button as a growing circle until it covers the screen. Browsers without
  // view transitions, and "reduce motion", switch at once.
  function toggle(e: React.MouseEvent<HTMLButtonElement>) {
    if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return apply();
    const b = e.currentTarget.getBoundingClientRect();
    const x = b.left + b.width / 2;
    const y = b.top + b.height / 2;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)); // to the farthest corner
    // Colour fades are paused while the circle runs, so the new theme lands in one steady sweep.
    const html = document.documentElement;
    html.classList.add("theme-switching");
    const t = document.startViewTransition(apply);
    t.ready.then(() =>
      html.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 600, easing: "linear", pseudoElement: "::view-transition-new(root)" },
      ),
    );
    t.finished.finally(() => html.classList.remove("theme-switching"));
  }

  return (
    <motion.button
      type="button"
      onClick={toggle}
      whileTap={{ rotate: 90, scale: 0.9 }}
      aria-label="Switch between light and dark mode"
      className="grid size-10 place-items-center rounded-full border border-line bg-surface text-ink hover:border-ink/40"
    >
      {/* Moon in light mode, sun in dark mode. */}
      <svg className="size-5 dark:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
      </svg>
      <svg className="hidden size-5 dark:block" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    </motion.button>
  );
}
