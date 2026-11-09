"use client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { AwayKind } from "@/lib/away";

// The round "+" above Ask Almanac: one tap to start any of the things you add most.
export function CreateMenu({
  canEdit,
  onNew,
  onTodo,
  onMeeting,
  onAway,
}: {
  canEdit: boolean;
  onNew: () => void;
  onTodo: () => void;
  onMeeting: () => void;
  onAway: (kind: AwayKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const items: [string, string, () => void, boolean][] = [
    ["New event", "Type or say what and when", onNew, canEdit],
    ["To-do", "Something to get done", onTodo, true],
    ["New meeting", "With guests and a Meet link", onMeeting, canEdit],
    ["Out of office", "Show you're away", () => onAway("ooo"), canEdit],
    ["Focus time", "Block time to concentrate", () => onAway("focus"), canEdit],
  ];

  return (
    <div ref={ref} className="fixed bottom-[4.75rem] right-5 z-30 flex flex-col items-end gap-2">
      <AnimatePresence>
        {open && (
          <motion.ul
            id="create-menu"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
            className="flex w-60 flex-col overflow-hidden rounded-2xl border border-line bg-surface py-1 shadow-xl"
          >
            {items.map(([label, hint, run, enabled]) => (
              <li key={label}>
                <button
                  type="button"
                  disabled={!enabled}
                  onClick={() => {
                    setOpen(false);
                    run();
                  }}
                  className="w-full px-4 py-2 text-left hover:bg-ink/5 disabled:opacity-40"
                >
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-muted">{hint}</span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
      <motion.button
        type="button"
        onClick={() => setOpen((o) => !o)}
        whileTap={{ scale: 0.92 }}
        aria-expanded={open}
        aria-controls="create-menu"
        aria-label={open ? "Close the add menu" : "Add: new event, to-do, meeting, out of office, focus time"}
        className="grid size-12 place-items-center rounded-full bg-ink text-paper shadow-xl"
      >
        <motion.svg animate={{ rotate: open ? 45 : 0 }} className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </motion.svg>
      </motion.button>
    </div>
  );
}
