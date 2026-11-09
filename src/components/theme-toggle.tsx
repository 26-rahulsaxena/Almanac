"use client";
import { motion } from "motion/react";

// className: its size (the top bar makes it a little smaller on phones); 40 px otherwise.
export function ThemeToggle({ className = "size-10" }: { className?: string }) {
  function apply() {
    const dark = document.documentElement.classList.toggle("dark");
    try {
      localStorage.theme = dark ? "dark" : "light";
    } catch {}
  }

  // The new theme spreads as a growing circle from the theme button in the top bar (even when switched from
  // Settings) until it covers the screen. Browsers without view transitions, and "reduce motion", switch at once.
  function toggle(e: React.MouseEvent<HTMLButtonElement>) {
    const html = document.documentElement;
    if (html.classList.contains("theme-switching")) return; // a second tap mid-sweep would cut the first one short
    if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches) return apply();
    const from = document.querySelector("header [data-theme-toggle]") ?? e.currentTarget;
    const b = from.getBoundingClientRect();
    const x = b.left + b.width / 2;
    const y = b.top + b.height / 2;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)); // to the farthest corner
    // Colour fades are paused while the circle runs, so the new theme lands in one sweep.
    html.classList.add("theme-switching");
    const t = document.startViewTransition(apply);
    t.ready.then(() =>
      html.animate(
        // Starts the size of the button and grows at one steady speed, so it's seen coming out of the button
        // from the first moment (a slow start hid it behind the button).
        { clipPath: [`circle(${b.width / 2}px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
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
      data-theme-toggle
      className={`grid place-items-center rounded-full border border-line bg-surface text-ink hover:border-ink/40 ${className}`}
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
