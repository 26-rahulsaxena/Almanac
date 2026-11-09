"use client";
import { useState } from "react";
import type { Proposal } from "@/lib/quick-add";
import { Modal } from "./coach";
import { MicButton } from "./mic-button";

// "+ New event": type or say one line; it opens in the event form to check and save. Always an event (to-dos have
// their own "To-do" entry). "Fill in the form yourself" opens the empty form, as before.
export function QuickAdd({ onClose, onEvent, onForm }: { onClose: () => void; onEvent: (p: Proposal) => void; onForm: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);

  async function parse(line: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/quick-add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: line }) });
      const p = await r.json().catch(() => null);
      if (!r.ok) throw new Error(p?.error === "signin" ? "Sign in again to use quick add." : (p?.error ?? "Quick add isn't working right now."));
      onEvent(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New event" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) parse(text.trim());
        }}
        className="flex gap-2"
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">What and when</span>
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
        {listening ? "Listening… say what and when." : "Type or say what and when. It opens in the form so you can check it before saving. Nobody is invited."}
      </p>
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
