"use client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useDialog } from "./use-dialog";

type Alert = { id: string; title: string; body: string };

const CHECK_MS = 30_000;
const CHIME_EVERY_MS = 4_000;
const CHIME_FOR_MS = 2 * 60_000;

// A soft two-note chime, made in the browser (no sound file).
function chime(ctx: AudioContext) {
  const t = ctx.currentTime;
  [880, 1318.5].forEach((freq, i) => {
    const at = t + i * 0.18;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.7);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.75);
  });
}

// While Almanac is open, a reminder that goes off takes over the whole screen with a chime until you answer it.
// Reminders come from the minute job (the same ones sent as notifications), so this works even where
// notifications are blocked. Browsers only allow sound after you've clicked or typed on the page once.
export function FullScreenAlert() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const audio = useRef<AudioContext | null>(null);

  useEffect(() => {
    const unlock = () => {
      audio.current ??= new AudioContext();
      audio.current.resume().catch(() => {});
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);

    const check = () =>
      fetch("/api/alerts")
        .then((r) => (r.ok ? r.json() : null))
        .then((list: Alert[] | null) => list && setAlerts(list))
        .catch(() => {});
    check();
    const timer = setInterval(check, CHECK_MS);
    const onMessage = (e: MessageEvent) => e.data === "check-alerts" && check();
    const onVisible = () => document.visibilityState === "visible" && check();
    navigator.serviceWorker?.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      clearInterval(timer);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const current = alerts[0];
  const currentId = current?.id; // each check returns a fresh list; keep chiming on the same alert, don't restart
  useEffect(() => {
    if (!currentId) return;
    const ring = () => audio.current?.state === "running" && chime(audio.current);
    ring();
    const started = Date.now();
    const timer = setInterval(() => (Date.now() - started < CHIME_FOR_MS ? ring() : clearInterval(timer)), CHIME_EVERY_MS);
    return () => clearInterval(timer);
  }, [currentId]);

  async function answer(action: "done" | "snooze") {
    if (!current) return;
    setAlerts((a) => a.slice(1));
    await fetch("/api/reminders/ack", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: current.id, action }) }).catch(() => {});
  }

  return (
    <AnimatePresence>
      {current && <AlertScreen key={current.id} alert={current} left={alerts.length - 1} onAnswer={answer} />}
    </AnimatePresence>
  );
}

function AlertScreen({ alert, left, onAnswer }: { alert: Alert; left: number; onAnswer: (a: "done" | "snooze") => void }) {
  const ref = useDialog<HTMLDivElement>(() => onAnswer("snooze")); // Esc = snooze, never silently dismissed
  return (
    <motion.div
      ref={ref}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="alert-title"
      aria-describedby="alert-when"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] grid place-items-center overflow-hidden bg-[#141210] px-6 text-[#f6f1e7]"
    >
      {/* Ripples from the centre, so it reads as "now" even from across the room. */}
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          aria-hidden
          className="pointer-events-none absolute size-[40vmin] rounded-full border-2 border-accent"
          initial={{ scale: 0.4, opacity: 0.7 }}
          animate={{ scale: 3.2, opacity: 0 }}
          transition={{ duration: 3.6, repeat: Infinity, delay: i * 1.2, ease: "easeOut" }}
        />
      ))}
      <motion.div
        initial={{ scale: 0.9, y: 24, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        transition={{ type: "spring", damping: 18, stiffness: 220 }}
        className="relative max-w-3xl text-center"
      >
        <p className="font-mono text-xs uppercase tracking-[0.35em] text-accent">Reminder{left > 0 ? ` · ${left} more after this` : ""}</p>
        <h2 id="alert-title" className="mt-5 break-words font-serif text-5xl leading-tight sm:text-7xl">
          {alert.title}
        </h2>
        <p id="alert-when" className="mt-5 text-lg text-[#f6f1e7]/75 sm:text-xl">
          {alert.body}
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            data-autofocus
            onClick={() => onAnswer("done")}
            className="rounded-full bg-accent px-8 py-3.5 text-lg font-medium text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/40"
          >
            Done, I&apos;m on it
          </button>
          <button
            type="button"
            onClick={() => onAnswer("snooze")}
            className="rounded-full border border-[#f6f1e7]/30 px-8 py-3.5 text-lg hover:border-[#f6f1e7]/60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#f6f1e7]/30"
          >
            Snooze 5 min
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
