"use client";
import { motion } from "motion/react";
import type { ComponentProps } from "react";
import { Modal } from "./coach";
import { Routines } from "./routines";
import { Suggestions } from "./suggestions";
import { TodoList } from "./todo-list";
import { useDialog } from "./use-dialog";

// The "+ To-do" pop-up: the to-do list (add, edit, tick off, remove) and focus time & habits, in one place.
// at: opened from the header's To-do button, so it hangs under it as a bubble (see Modal).
export function TodoDialog({ onClose, at, ...list }: Omit<ComponentProps<typeof TodoList>, "autoFocus"> & { onClose: () => void; at?: DOMRect | null }) {
  const ref = useDialog<HTMLDivElement>(onClose);
  if (at)
    return (
      <Modal title="To-dos" onClose={onClose} at={at}>
        <TodoBody {...list} autoFocus />
      </Modal>
    );
  return (
    <>
      <motion.div className="fixed inset-0 z-40 bg-ink/25 backdrop-blur-[2px]" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4">
        <motion.div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby="todo-dialog-title"
          initial={{ scale: 0.95, opacity: 0, y: 12 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.97, opacity: 0, y: 8 }}
          transition={{ type: "spring", damping: 26, stiffness: 340 }}
          className="pointer-events-auto flex max-h-[min(44rem,calc(100dvh-2rem))] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-2xl"
        >
          <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 id="todo-dialog-title" className="font-serif text-2xl">
              To-dos
            </h2>
            <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-full text-muted hover:bg-ink/5 hover:text-ink">
              ✕
            </button>
          </header>
          <div className="overflow-y-auto px-5 pb-5">
            <TodoBody {...list} autoFocus />
          </div>
        </motion.div>
      </div>
    </>
  );
}

// What's inside it, also the phone's "To-do" tab.
export function TodoBody(list: ComponentProps<typeof TodoList>) {
  return (
    <>
      <div className="mt-3 empty:hidden">
        <Suggestions version={list.version} onCalendarChange={list.onCalendarChange} />
      </div>
      <TodoList {...list} />
      <h3 className="mt-6 font-mono text-xs uppercase tracking-[0.2em] text-muted">Focus time &amp; habits</h3>
      <Routines onCalendarChange={list.onCalendarChange} />
    </>
  );
}
