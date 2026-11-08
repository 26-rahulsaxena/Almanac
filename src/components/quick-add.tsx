"use client";
import { useState } from "react";
import type { Proposal } from "@/lib/quick-add";
import { Modal } from "./coach";
import { MicButton } from "./mic-button";

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

type Todo = Extract<Proposal, { kind: "todo" }>;

// "+ New": type or say one line. An event opens in the event form to check and save; a to-do waits for "Add".
// "Fill in the form yourself" opens the empty form, as before.
export function QuickAdd({ onClose, onEvent, onForm, onTodoAdded }: { onClose: () => void; onEvent: (p: Exclude<Proposal, Todo>) => void; onForm: () => void; onTodoAdded: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [todo, setTodo] = useState<Todo | null>(null);
  const [added, setAdded] = useState(false);
  const [listening, setListening] = useState(false);

  async function parse(line: string) {
    setBusy(true);
    setError(null);
    setTodo(null);
    setAdded(false);
    try {
      const r = await fetch("/api/quick-add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: line }) });
      const p = await r.json().catch(() => null);
      if (!r.ok) throw new Error(p?.error === "signin" ? "Sign in again to use quick add." : (p?.error ?? "Quick add isn't working right now."));
      if (p.kind === "todo") setTodo(p);
      else onEvent(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addTodo(t: Todo) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/todos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: t.title, due: t.due, minutes: t.minutes }) });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "Couldn't add it.");
      setAdded(true);
      setTodo(null);
      setText("");
      onTodoAdded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) parse(text.trim());
        }}
        className="flex gap-2"
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">What to add</span>
          <input
            data-autofocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={300}
            placeholder="Lunch Friday 1 pm"
            className="w-full rounded-full border border-line bg-paper px-4 py-2 text-sm outline-none focus:border-ink/40"
          />
        </label>
        <MicButton
          onText={setText}
          onEnd={parse}
          onListening={(on) => {
            setListening(on);
            if (on) setError(null);
          }}
          onError={setError}
        />
        <button type="submit" disabled={busy || !text.trim()} className="shrink-0 rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50">
          {busy ? "…" : "Add"}
        </button>
      </form>
      <p className="mt-2 text-xs text-muted" aria-live="polite">
        {listening ? "Listening… say what and when." : "Type or say an event or a to-do. An event opens in the form so you can check it before saving. Nobody is invited."}
      </p>
      {todo && (
        <div className="mt-4 rounded-2xl border border-line p-3 text-sm">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent">To-do</p>
          <p className="mt-1 break-words font-medium">{todo.title}</p>
          <p className="text-xs text-muted">{todo.due ? `Due ${when(todo.due)}` : "No due date"}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy} onClick={() => addTodo(todo)} className="rounded-full bg-ink px-3 py-1 text-xs font-medium text-paper disabled:opacity-50">
              Add to-do
            </button>
            <button type="button" onClick={() => setTodo(null)} className="rounded-full border border-line px-3 py-1 text-xs hover:border-ink/40">
              Cancel
            </button>
          </div>
        </div>
      )}
      {added && <p className="mt-3 text-sm">Added to your to-do list.</p>}
      {error && (
        <p role="alert" className="mt-3 text-sm text-accent">
          {error}
        </p>
      )}
      <button type="button" onClick={onForm} className="mt-4 text-sm text-accent hover:underline">
        Fill in the form yourself →
      </button>
    </Modal>
  );
}
