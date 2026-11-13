"use client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

const pad = (n: number) => String(n).padStart(2, "0");
const ROW = 32; // px per row (h-8 below); 5 rows show, the middle one is the choice
const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = Array.from({ length: 60 }, (_, i) => pad(i));

export function formatClock(value: string) {
  const [h, m] = value.split(":").map(Number);
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? "am" : "pm"}`;
}

// Almanac's time picker, in place of the browser's: hour, minutes (every minute, 00–59)
// and am/pm as wheels you flick or scroll; hours and minutes go round and round. value/onChange use "HH:MM" (24 h),
// like <input type="time">. ↑ ↓ on a wheel move it, Escape or Done closes.
export function TimeWheel({ value, onChange, className = "", "aria-label": ariaLabel }: { value: string; onChange: (v: string) => void; className?: string; "aria-label"?: string }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [toRight, setToRight] = useState(false); // opens to the right of a field near the left edge, so it stays on screen
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [h, m] = (value || "09:00").split(":").map(Number);
  const pm = h >= 12;

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const set = (hour12: number, minute: number, isPm: boolean) => onChange(`${pad((hour12 % 12) + (isPm ? 12 : 0))}:${pad(minute)}`);
  const hour12 = h % 12 || 12;

  function close() {
    setOpen(false);
    button.current?.focus();
  }

  function show() {
    const r = box.current!.getBoundingClientRect();
    setUp(innerHeight - r.bottom < 230 && r.top > innerHeight - r.bottom);
    setToRight(r.right - 192 < 8); // 192 = w-48, the popup's width
    setOpen(true);
  }

  return (
    <div ref={box} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={ariaLabel ? `${ariaLabel}: ${formatClock(value)}` : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => open && e.key === "Escape" && (e.stopPropagation(), setOpen(false))}
        className={`flex items-center justify-between gap-2 whitespace-nowrap text-left text-ink ${className}`}
      >
        {formatClock(value)}
        <svg className="size-4 shrink-0 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            data-popup
            role="dialog"
            aria-label={ariaLabel ?? "Time"}
            onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), close())}
            initial={{ opacity: 0, y: up ? 6 : -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: up ? 6 : -6, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className={`absolute ${toRight ? "left-0" : "right-0"} z-30 w-48 rounded-2xl border border-line bg-surface p-1.5 shadow-xl ${up ? "bottom-full mb-1" : "top-full mt-1"}`}
          >
            <div className="relative grid grid-cols-[1fr_1fr_0.9fr]">
              <span className="pointer-events-none absolute inset-x-0 top-1/2 h-8 -translate-y-1/2 rounded-lg bg-ink/5" aria-hidden />
              <Wheel label="Hour" items={HOURS} index={hour12 - 1} loop onPick={(i) => set(i + 1, m, pm)} />
              <Wheel label="Minutes" items={MINUTES} index={m} loop onPick={(i) => set(hour12, i, pm)} />
              <Wheel label="am or pm" items={["am", "pm"]} index={pm ? 1 : 0} onPick={(i) => set(hour12, m, i === 1)} />
            </div>
            <button type="button" onClick={close} className="mt-1.5 w-full rounded-full bg-ink py-1 text-sm font-medium text-paper">
              Done
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// One wheel. Looping wheels repeat their items 7 times and, after each scroll, jump back to the middle copy
// without moving the picture, so they never reach an end.
function Wheel({ label, items, index, loop, onPick }: { label: string; items: string[]; index: number; loop?: boolean; onPick: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);
  const n = items.length;
  const copies = loop ? 7 : 1;
  const base = loop ? 3 * n : 0;

  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = (base + index) * ROW;
  }, [base, index]);

  function onScroll() {
    clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const i = (((Math.round(el.scrollTop / ROW) - base) % n) + n) % n;
      if (i !== index) onPick(i);
      else el.scrollTop = (base + i) * ROW; // went all the way round: back to the middle copy
    }, 120);
  }

  const step = (d: number) => ref.current?.scrollBy({ top: d * ROW, behavior: "smooth" });

  return (
    <div
      ref={ref}
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuetext={items[index]}
      onScroll={onScroll}
      onKeyDown={(e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        step(e.key === "ArrowDown" ? 1 : -1);
      }}
      className="relative h-[160px] snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-lg py-[64px] text-center outline-none [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-accent/50 [&::-webkit-scrollbar]:hidden"
      style={{ maskImage: "linear-gradient(transparent, black 35%, black 65%, transparent)" }}
    >
      {Array.from({ length: copies }, (_, c) =>
        items.map((it, i) => (
          <div
            key={`${c}-${i}`}
            onClick={() => ref.current?.scrollTo({ top: (c * n + i) * ROW, behavior: "smooth" })}
            className={`grid h-8 cursor-pointer snap-center place-items-center font-mono text-base tabular-nums ${i === index ? "text-ink" : "text-muted"}`}
            aria-hidden
          >
            {it}
          </div>
        )),
      )}
    </div>
  );
}
