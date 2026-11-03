"use client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { Alert } from "@/app/api/alerts/route";
import { useDialog } from "./use-dialog";

const CHECK_MS = 30_000;
// Step 1 is a pop-up card with a soft chime; unanswered after this long, step 2 takes the whole screen with an alarm.
const ESCALATE_MS = 60_000;
const CHIME_EVERY_MS = 8_000;
const ALARM_EVERY_MS = 1_500;
const ALARM_FOR_MS = 10 * 60_000; // then the screen stays, but goes quiet

function tone(ctx: AudioContext, freq: number, at: number, length: number, type: OscillatorType, volume: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + length + 0.05);
}
// Made in the browser, no sound files. Soft two-note chime for the pop-up…
const chime = (ctx: AudioContext) => [880, 1318.5].forEach((f, i) => tone(ctx, f, ctx.currentTime + i * 0.18, 0.7, "sine", 0.3));
// …and a sharp, fast four-beep alarm for full screen.
const alarm = (ctx: AudioContext) => [1046, 1480, 1046, 1480].forEach((f, i) => tone(ctx, f, ctx.currentTime + i * 0.16, 0.12, "square", 0.22));

type Answer = { label: string; action: string; primary?: boolean };
function answersFor(a: Alert): Answer[] {
  if (a.kind === "reminder")
    return [
      { label: "Done, I'm on it", action: "done", primary: true },
      { label: "Snooze 5 min", action: "snooze" },
    ];
  if (a.ask === "start")
    return [
      { label: "Starting now", action: "doing", primary: true },
      { label: "Ask again in 5 min", action: "snooze" },
    ];
  return [
    { label: "Yes, it's done", action: "done", primary: true },
    { label: "Need 30 more min", action: "more" },
    { label: "Ask again in 5 min", action: "snooze" },
  ];
}

// Reminders and check-ins inside the open app, in two steps: a pop-up with a chime, then (if unanswered for a
// minute) the whole screen with an alarm. Snoozed reminders and "more time" check-ins come back and go through
// both steps again. Works even where notifications are blocked. Sound plays in a background tab too, but
// browsers only allow it after you've clicked or typed on the page once.
export function FullScreenAlert({ onChanged }: { onChanged: () => void }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [soundOn, setSoundOn] = useState(false);
  const audio = useRef<AudioContext | null>(null);

  useEffect(() => {
    const unlock = () => {
      audio.current ??= new AudioContext();
      audio.current.resume().then(() => setSoundOn(true), () => {});
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
  const currentId = current?.id; // each check returns a fresh list; keep going on the same alert, don't restart
  const full = !!current && now - +new Date(current.sentAt) >= ESCALATE_MS;

  // A clock for the escalation, ticking only while something is waiting.
  useEffect(() => {
    if (!currentId) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [currentId]);

  // Sound: chime while it's a pop-up, alarm once it's full screen.
  useEffect(() => {
    if (!currentId) return;
    const play = () => audio.current?.state === "running" && (full ? alarm : chime)(audio.current);
    play();
    const started = Date.now();
    const timer = setInterval(() => (Date.now() - started < ALARM_FOR_MS ? play() : clearInterval(timer)), full ? ALARM_EVERY_MS : CHIME_EVERY_MS);
    return () => clearInterval(timer);
  }, [currentId, full, soundOn]);

  // The tab title flashes, so it's noticed from another tab.
  useEffect(() => {
    if (!current) return;
    const original = document.title;
    let on = false;
    const timer = setInterval(() => {
      on = !on;
      document.title = on ? `⏰ ${current.title}` : original;
    }, 1000);
    return () => {
      clearInterval(timer);
      document.title = original;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only for a different alert
  }, [currentId]);

  async function answer(action: string) {
    if (!current) return;
    setAlerts((a) => a.slice(1));
    const url = current.kind === "reminder" ? "/api/reminders/ack" : "/api/priorities/answer";
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: current.id, action }) }).catch(() => {});
    if (current.kind === "checkin") onChanged();
  }

  const left = alerts.length - 1;
  const secondsLeft = current ? Math.max(0, Math.ceil((+new Date(current.sentAt) + ESCALATE_MS - now) / 1000)) : 0;
  return (
    <AnimatePresence>
      {current &&
        (full ? (
          <FullScreen key={`full-${current.id}`} alert={current} left={left} onAnswer={answer} />
        ) : (
          <PopUp key={`pop-${current.id}`} alert={current} left={left} secondsLeft={secondsLeft} soundOn={soundOn} onAnswer={answer} />
        ))}
    </AnimatePresence>
  );
}

type ViewProps = { alert: Alert; left: number; onAnswer: (action: string) => void };
const label = (a: Alert, left: number) => `${a.kind === "reminder" ? "Reminder" : "Check-in"}${left > 0 ? ` · ${left} more after this` : ""}`;

// Step 1: a card in the corner. Doesn't take focus, so typing elsewhere isn't interrupted.
function PopUp({ alert, left, secondsLeft, soundOn, onAnswer }: ViewProps & { secondsLeft: number; soundOn: boolean }) {
  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: -16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.97 }}
      transition={{ type: "spring", damping: 22, stiffness: 300 }}
      className="fixed right-4 top-4 z-[65] w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-accent/50 bg-surface p-4 shadow-2xl"
    >
      <motion.span
        aria-hidden
        className="absolute inset-x-0 top-0 h-1 origin-left bg-accent"
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: secondsLeft, ease: "linear" }}
      />
      <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent">{label(alert, left)}</p>
      <p className="mt-1.5 break-words font-serif text-2xl leading-snug">{alert.title}</p>
      <p className="mt-1 text-sm text-muted">{alert.body}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {answersFor(alert).map((a) => (
          <button
            key={a.action}
            type="button"
            onClick={() => onAnswer(a.action)}
            className={`rounded-full px-3.5 py-1.5 text-sm ${a.primary ? "bg-accent font-medium text-white" : "border border-line hover:border-ink/40"}`}
          >
            {a.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">
        Goes full screen in {secondsLeft}s if not answered.{!soundOn && " Click anywhere on the page once to allow sound."}
      </p>
    </motion.div>
  );
}

// Step 2: the whole screen, with focus, until it's answered. Esc = ask again later, never silently dismissed.
function FullScreen({ alert, left, onAnswer }: ViewProps) {
  const answers = answersFor(alert);
  const ref = useDialog<HTMLDivElement>(() => onAnswer("snooze"));
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
          transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.8, ease: "easeOut" }}
        />
      ))}
      <motion.div
        initial={{ scale: 0.85, y: 30, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        transition={{ type: "spring", damping: 14, stiffness: 240 }}
        className="relative max-w-3xl text-center"
      >
        <p className="font-mono text-xs uppercase tracking-[0.35em] text-accent">{label(alert, left)}</p>
        <h2 id="alert-title" className="mt-5 break-words font-serif text-5xl leading-tight sm:text-7xl">
          {alert.title}
        </h2>
        <p id="alert-when" className="mt-5 text-lg text-[#f6f1e7]/75 sm:text-xl">
          {alert.body}
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          {answers.map((a) => (
            <button
              key={a.action}
              type="button"
              data-autofocus={a.primary || undefined}
              onClick={() => onAnswer(a.action)}
              className={`rounded-full px-8 py-3.5 text-lg focus-visible:outline-none focus-visible:ring-4 ${
                a.primary ? "bg-accent font-medium text-white focus-visible:ring-accent/40" : "border border-[#f6f1e7]/30 hover:border-[#f6f1e7]/60 focus-visible:ring-[#f6f1e7]/30"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
