"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { almanacPlugin, appCanListen, isAndroidApp } from "@/lib/android-app";

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
// Inside the Android app the browser's speech-to-text doesn't work: new versions use the phone's voice typing,
// older ones hide the button.
const canSpeakHere = () => (isAndroidApp() ? appCanListen() : !!speech());

// Speak instead of typing. onText gets the words as they're heard; onEnd the final words once you stop.
// Shows nothing in browsers without speech-to-text (e.g. Firefox).
export function MicButton({ onText, onEnd, onError, onListening }: { onText: (t: string) => void; onEnd?: (t: string) => void; onError: (msg: string) => void; onListening?: (on: boolean) => void }) {
  const [listening, setListening] = useState(false);
  const rec = useRef<Rec | null>(null);
  const canSpeak = useSyncExternalStore(noChanges, canSpeakHere, () => false);
  useEffect(() => () => rec.current?.stop(), []);

  async function listenInApp() {
    setListening(true);
    onListening?.(true);
    try {
      const { text } = await (await almanacPlugin()).listen();
      if (text.trim()) {
        onText(text.trim());
        onEnd?.(text.trim());
      }
    } catch (e) {
      onError((e as Error).message || "Didn't catch that. Try again, or type it.");
    } finally {
      setListening(false);
      onListening?.(false);
    }
  }

  function toggle() {
    if (isAndroidApp()) return listening ? undefined : listenInApp();
    if (rec.current) return rec.current.stop();
    const R = speech();
    if (!R) return;
    const r = new R();
    r.lang = navigator.language || "en-IN";
    r.interimResults = true;
    let heard = "";
    r.onresult = (e) => onText((heard = Array.from(e.results, (x) => x[0].transcript).join("")));
    r.onerror = (e) => onError(e.error === "not-allowed" ? "The microphone is blocked. Allow it for this site, or type instead." : "Didn't catch that. Try again, or type it.");
    r.onend = () => {
      rec.current = null;
      setListening(false);
      onListening?.(false);
      if (heard.trim()) onEnd?.(heard.trim());
    };
    rec.current = r;
    setListening(true);
    onListening?.(true);
    r.start();
  }

  if (!canSpeak) return null;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={listening}
      aria-label={listening ? "Stop listening" : "Say it"}
      className={`grid size-9 shrink-0 place-items-center rounded-full border ${listening ? "animate-pulse border-accent bg-accent text-paper" : "border-line hover:border-ink/40"}`}
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
    </button>
  );
}
