"use client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

type Turn = { role: "user" | "assistant"; text: string };

const IDEAS = ["What should I do first today?", "When am I free tomorrow?", "Find time for my to-dos", "Block 1 hour for the gym this evening"];

// Chat with the planning assistant. It sits beside the calendar (not over it) so you can watch it add things.
// The conversation lives only in this tab.
export function Assistant({ open, onOpenChange, onChanged }: { open: boolean; onOpenChange: (o: boolean) => void; onChanged: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" }); // braces: newer browsers return a promise here, which React would treat as cleanup
  }, [turns, thinking]);

  async function ask(q: string) {
    q = q.trim();
    if (!q || thinking) return;
    const next = [...turns, { role: "user" as const, text: q }];
    setTurns(next);
    setText("");
    setError(null);
    setThinking(true);
    try {
      const r = await fetch("/api/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: next.slice(-30) }) });
      const data = await r.json().catch(() => null);
      if (!r.ok) {
        setError(
          data?.error === "nokey"
            ? "The assistant needs an Anthropic API key. Add ANTHROPIC_API_KEY to .env.local and restart the app."
            : data?.error === "reauth"
              ? "Google needs you to sign in again."
              : (data?.error ?? "The assistant couldn't answer. Try again."),
        );
        setTurns(turns); // take the question back so it can be asked again
        setText(q);
        return;
      }
      setTurns([...next, { role: "assistant", text: data.reply }]);
      if (data.changed) onChanged();
    } catch {
      setError("Couldn't reach the app. Check your connection.");
      setTurns(turns);
      setText(q);
    } finally {
      setThinking(false);
    }
  }

  return (
    <>
      <AnimatePresence>
        {!open && (
          <motion.button
            type="button"
            onClick={() => onOpenChange(true)}
            initial={{ opacity: 0, y: 16, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.9 }}
            whileTap={{ scale: 0.94 }}
            className="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-medium text-paper shadow-xl"
            title="Assistant (K)"
          >
            <span className="size-2 rounded-full bg-accent" aria-hidden />
            Ask Almanac
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.section
            role="dialog"
            aria-modal="false"
            aria-label="Assistant"
            onKeyDown={(e) => e.key === "Escape" && onOpenChange(false)}
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ type: "spring", damping: 28, stiffness: 340 }}
            className="fixed bottom-4 right-4 z-30 flex h-[min(38rem,calc(100dvh-6rem))] w-[min(26rem,calc(100vw-2rem))] origin-bottom-right flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <h2 className="font-serif text-xl">Assistant</h2>
                <p className="text-xs text-muted">Plans your time and books blocks. Never invites or deletes.</p>
              </div>
              <div className="flex items-center gap-1">
                {turns.length > 0 && (
                  <button type="button" onClick={() => setTurns([])} className="rounded-full px-2.5 py-1 text-xs text-muted hover:text-ink">
                    Clear
                  </button>
                )}
                <button type="button" onClick={() => onOpenChange(false)} aria-label="Close assistant" className="grid size-8 place-items-center rounded-full text-muted hover:bg-ink/5 hover:text-ink">
                  ✕
                </button>
              </div>
            </header>

            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
              {turns.length === 0 && (
                <div className="space-y-2">
                  <p className="text-sm text-muted">Ask about your week, what to do first, or tell me to block time.</p>
                  <div className="flex flex-wrap gap-1.5">
                    {IDEAS.map((q) => (
                      <button key={q} type="button" onClick={() => ask(q)} className="rounded-full border border-line px-3 py-1 text-left text-xs hover:border-ink/40">
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {turns.map((t, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                    t.role === "user" ? "ml-auto rounded-br-md bg-ink text-paper" : "rounded-bl-md bg-ink/[0.05]"
                  }`}
                >
                  {t.text}
                </motion.div>
              ))}
              {thinking && (
                <div className="flex w-fit gap-1 rounded-2xl rounded-bl-md bg-ink/[0.05] px-4 py-3" aria-label="Thinking">
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      className="size-1.5 rounded-full bg-muted"
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
                    />
                  ))}
                </div>
              )}
              {error && (
                <p role="alert" className="rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-sm">
                  {error}
                </p>
              )}
              <div ref={end} />
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                ask(text);
              }}
              className="flex items-end gap-2 border-t border-line p-3"
            >
              <label className="min-w-0 flex-1">
                <span className="sr-only">Message</span>
                <textarea
                  ref={input}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      ask(text);
                    }
                  }}
                  rows={1}
                  maxLength={4000}
                  placeholder="e.g. Book 2 hours to study before Friday"
                  className="max-h-32 w-full resize-none rounded-xl border border-line bg-paper px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                />
              </label>
              <button type="submit" disabled={thinking || !text.trim()} className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-40">
                Send
              </button>
            </form>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  );
}
