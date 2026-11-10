"use client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

// Almanac's own dropdown, in place of the browser's (which looks different on every phone and computer).
// Works like <select>: click or Enter/Space opens it, ↑ ↓ Home End move, Enter picks, Escape closes.
// It opens upwards when there's no room below.
export function Select({
  value,
  options,
  onChange,
  placeholder,
  className = "",
  id,
  disabled,
  "aria-label": ariaLabel,
}: {
  value: string;
  options: [string, string][]; // [value, label]
  onChange: (value: string) => void;
  placeholder?: string; // shown when value isn't one of the options
  className?: string;
  id?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const current = options.find(([v]) => v === value);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function show() {
    const r = box.current!.getBoundingClientRect();
    setUp(innerHeight - r.bottom < 260 && r.top > innerHeight - r.bottom);
    setActive(Math.max(0, options.findIndex(([v]) => v === value)));
    setOpen(true);
  }

  function pick(i: number) {
    setOpen(false);
    if (options[i] && options[i][0] !== value) onChange(options[i][0]);
  }

  function onKey(e: React.KeyboardEvent) {
    const keys: Record<string, () => void> = {
      ArrowDown: () => (open ? setActive((a) => Math.min(a + 1, options.length - 1)) : show()),
      ArrowUp: () => (open ? setActive((a) => Math.max(a - 1, 0)) : show()),
      Home: () => open && setActive(0),
      End: () => open && setActive(options.length - 1),
      Enter: () => (open ? pick(active) : show()),
      " ": () => (open ? pick(active) : show()),
      Escape: () => open && setOpen(false),
    };
    if (!keys[e.key]) return;
    if (open || e.key !== "Escape") e.preventDefault();
    if (e.key === "Escape" && open) e.stopPropagation(); // close the list, not the panel around it
    keys[e.key]();
  }

  return (
    <div ref={box} className={`relative ${className.includes("w-full") ? "block w-full" : "inline-block align-middle"}`}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
        onBlur={(e) => !box.current?.contains(e.relatedTarget) && setOpen(false)}
        className={`flex items-center justify-between gap-2 text-left text-ink disabled:opacity-60 ${className}`}
      >
        <span className={`truncate ${current ? "" : "text-muted"}`}>{current?.[1] ?? placeholder}</span>
        <svg className={`size-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            ref={list}
            role="listbox"
            aria-label={ariaLabel}
            initial={{ opacity: 0, y: up ? 6 : -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: up ? 6 : -6, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className={`absolute left-0 z-30 max-h-64 min-w-full overflow-y-auto rounded-xl border border-line bg-surface p-1 text-sm shadow-xl ${up ? "bottom-full mb-1" : "top-full mt-1"}`}
          >
            {options.map(([v, label], i) => (
              <li
                key={v}
                role="option"
                aria-selected={v === value}
                onPointerEnter={() => setActive(i)}
                onPointerDown={(e) => e.preventDefault()} // focus stays on the button, so it doesn't close first
                onClick={() => pick(i)}
                className={`flex cursor-pointer items-center justify-between gap-3 whitespace-nowrap rounded-lg px-3 py-2 ${i === active ? "bg-ink/5" : ""}`}
              >
                {label}
                {v === value && <span className="text-accent" aria-hidden>✓</span>}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
