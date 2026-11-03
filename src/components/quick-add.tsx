"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Proposal } from "@/lib/quick-add";
import { Modal } from "./coach";

// The browser's speech-to-text (Chrome, Edge, Safari); not in TypeScript's built-in types.
type Rec = {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
const speech = () => {
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};
const noChanges = () => () => {};
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

type Todo = Extract<Proposal, { kind: "todo" }>;

// "Quick add": type or say one line. An event opens in the event form to check and save; a to-do waits for "Add".
export function QuickAdd({ onClose, onEvent, onTodoAdded }: { onClose: () => void; onEvent: (p: Exclude<Proposal, Todo>) => void; onTodoAdded: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [todo, setTodo] = useState<Todo | null>(null);
  const [added, setAdded] = useState(false);
  const [listening, setListening] = useState(false);
  const rec = useRef<Rec | null>(null);
  const canSpeak = useSyncExternalStore(noChanges, () => !!speech(), () => false);
  useEffect(() => () => rec.current?.stop(), []);

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

  function listen() {
    if (rec.current) return rec.current.stop();
    const R = speech();
    if (!R) return;
    const r = new R();
    r.lang = navigator.language || "en-IN";
    r.interimResults = true;
    let heard = "";
    r.onresult = (e) => setText((heard = Array.from(e.results, (x) => x[0].transcript).join("")));
    r.onerror = (e) => setError(e.error === "not-allowed" ? "The microphone is blocked. Allow it for this site, or type instead." : "Didn't catch that. Try again, or type it.");
    r.onend = () => {
      rec.current = null;
      setListening(false);
      if (heard.trim()) parse(heard.trim());
    };
    rec.current = r;
    setError(null);
    setListening(true);
    r.start();
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
    <Modal title="Quick add" onClose={onClose}>
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
            placeholder="Lunch with Riya Friday 1 pm at the cafe"
            className="w-full rounded-full border border-line bg-paper px-4 py-2 text-sm outline-none focus:border-ink/40"
          />
        </label>
        {canSpeak && (
          <button
            type="button"
            onClick={listen}
            aria-pressed={listening}
            aria-label={listening ? "Stop listening" : "Say it"}
            className={`grid size-9 shrink-0 place-items-center rounded-full border ${listening ? "animate-pulse border-accent bg-accent text-paper" : "border-line hover:border-ink/40"}`}
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </button>
        )}
        <button type="submit" disabled={busy || !text.trim()} className="shrink-0 rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50">
          {busy ? "…" : "Add"}
        </button>
      </form>
      <p className="mt-2 text-xs text-muted" aria-live="polite">
        {listening ? "Listening… say what and when." : "An event opens in the form so you can check it before saving. Nobody is invited."}
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
    </Modal>
  );
}
