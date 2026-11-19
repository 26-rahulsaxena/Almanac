"use client";
import { motion } from "motion/react";
import { useEffect, useState } from "react";

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}
function stored(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

// Dark or light from what's saved: Ember is always dark; otherwise the saved theme, or the device's (System).
function applyDark() {
  const theme = stored("theme", "");
  const dark = stored("look", "") === "ember" || theme === "dark" || (!theme && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}
const isEmber = () => stored("look", "") === "ember";

// Light, Dark, or System (follows the phone's or computer's setting, live: see layout.tsx). System is no saved
// theme; the top bar's button saves Light or Dark.
export function ThemeMode() {
  const [mode, setMode] = useState(() => stored("theme", "system"));
  const [ember, setEmber] = useState(isEmber);
  useEffect(() => {
    const on = () => setEmber(isEmber()); // the Look picker below says when it changes
    addEventListener("look", on);
    return () => removeEventListener("look", on);
  }, []);
  function pick(next: string) {
    try {
      if (next === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", next);
    } catch {}
    applyDark();
    setMode(next);
  }
  if (ember) return <span className="shrink-0 text-sm text-muted">Ember is always dark</span>;
  return (
    <div role="group" aria-label="Light or dark" className="flex shrink-0 rounded-full border border-line bg-surface p-0.5">
      {(["light", "dark", "system"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => pick(m)}
          className={`rounded-full px-3 py-1.5 text-sm capitalize transition-colors ${mode === m ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

// Ember's colour: a hue slider (0–359) over a rainbow drawn in OKLCH, the same space the CSS uses, so the colour
// under the thumb is the colour you get.
const RAINBOW = `linear-gradient(90deg, ${Array.from({ length: 13 }, (_, i) => `oklch(0.72 0.17 ${i * 30})`).join(", ")})`;
function HueSlider({ label, value, onChange }: { label: string; value: number; onChange: (hue: number) => void }) {
  return (
    <label className="mt-3 flex items-center gap-3 text-sm">
      {label}
      <input
        type="range"
        min={0}
        max={359}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 flex-1 cursor-pointer appearance-none rounded-full accent-accent"
        style={{ background: RAINBOW }}
      />
    </label>
  );
}

// The look: Paper (warm, solid; light or dark) or Ember (dark smoky glass with a warm glow in a colour you pick).
// Saved in this browser.
export function LookSettings() {
  const [look, setLook] = useState(() => (isEmber() ? "ember" : "paper"));
  const [emberHue, setEmberHue] = useState(() => Number(stored("emberHue", "44")));
  function hue(h: number) {
    document.documentElement.style.setProperty("--ember-hue", String(h));
    save("emberHue", String(h));
    setEmberHue(h);
  }
  function pick(next: "paper" | "ember") {
    document.documentElement.classList.toggle("ember", next === "ember");
    save("look", next);
    applyDark();
    dispatchEvent(new Event("look"));
    setLook(next);
  }
  return (
    <>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-sm">
          Look <span className="text-muted">· Paper, or Ember</span>
        </p>
        <div role="group" aria-label="Look" className="flex shrink-0 rounded-full border border-line bg-surface p-0.5">
          {(["paper", "ember"] as const).map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={look === l}
              onClick={() => pick(l)}
              className={`rounded-full px-3 py-1.5 text-sm capitalize transition-colors ${look === l ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      {look === "ember" && (
        <>
          <p className="mt-4 text-sm">
            Ember colour <span className="text-muted">· the glow, the highlights and your name</span>
          </p>
          <HueSlider label="Colour" value={emberHue} onChange={hue} />
          {emberHue !== 44 && (
            <button type="button" onClick={() => hue(44)} className="mt-2 text-xs text-muted underline hover:text-ink">
              Back to orange
            </button>
          )}
        </>
      )}
    </>
  );
}

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
    t.ready
      .then(() =>
        html.animate(
          // Starts the size of the button and grows at one steady speed, so it's seen coming out of the button
          // from the first moment (a slow start hid it behind the button).
          { clipPath: [`circle(${b.width / 2}px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
          { duration: 600, easing: "linear", pseudoElement: "::view-transition-new(root)" },
        ),
      )
      .catch(() => {}); // skipped (tab hidden, another transition): the theme has still switched
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
