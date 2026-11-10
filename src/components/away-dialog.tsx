"use client";
import { useState } from "react";
import { AWAY_TITLE, type AwayKind, type Decline } from "@/lib/away";
import { shiftDate, ymd } from "@/lib/recurrence";
import { Modal } from "./coach";
import { Select } from "./select";

const hhmm = (d: Date) => d.toTimeString().slice(0, 5);
const MESSAGE: Record<AwayKind, string> = {
  ooo: "I'm out of office and will reply when I'm back.",
  focus: "I'm in focus time. Could we find another time?",
};

// Out of office (whole days, or from–to times) or focus time (one stretch today or another day), plus whether
// Google should decline invitations that clash, with your message. Added to your main calendar.
export function AwayDialog({ kind, now, onClose, onSaved }: { kind: AwayKind; now: Date; onClose: () => void; onSaved: () => void }) {
  const today = ymd(now);
  const next = new Date(Math.ceil(+now / 1_800_000) * 1_800_000); // next half hour
  const [wholeDays, setWholeDays] = useState(kind === "ooo");
  const [from, setFrom] = useState(kind === "ooo" ? today : ymd(next));
  const [to, setTo] = useState(kind === "ooo" ? today : ymd(next));
  const [fromTime, setFromTime] = useState(kind === "ooo" ? "09:00" : hhmm(next));
  const [toTime, setToTime] = useState(kind === "ooo" ? "18:00" : hhmm(new Date(+next + 2 * 3_600_000)));
  const [decline, setDecline] = useState<Decline>("new");
  const [message, setMessage] = useState(MESSAGE[kind]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyBlock, setBusyBlock] = useState(false);

  async function save() {
    // Times are in this device's clock; focus time ends the same day it starts.
    const start = new Date(`${from}T${wholeDays ? "00:00" : fromTime}`);
    const end = new Date(wholeDays ? `${shiftDate(to, 1)}T00:00` : `${kind === "focus" ? from : to}T${toTime}`);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/away", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, start: start.toISOString(), end: end.toISOString(), decline, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error === "reauth" ? "Sign in again to continue." : (data.error ?? "Couldn't save. Try again."));
      onSaved();
      if (data.busyBlock) setBusyBlock(true);
      else onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const field = "rounded-xl border border-line bg-transparent px-3 py-2 text-sm outline-none focus:border-ink/40";
  const label = "block text-xs text-muted";

  if (busyBlock) {
    return (
      <Modal title={AWAY_TITLE[kind]} onClose={onClose}>
        <p className="text-sm">Added to your calendar as a busy block.</p>
        <p className="mt-2 text-sm text-muted">
          This Google account is a personal one, so it can&rsquo;t show an out-of-office status or decline invitations by itself. Work and school
          accounts can.
        </p>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="rounded-full bg-ink px-4 py-1.5 text-sm text-surface hover:bg-ink/85">
            Done
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={AWAY_TITLE[kind]} onClose={onClose}>
      <div className="space-y-4">
        {kind === "ooo" && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={wholeDays} onChange={(e) => setWholeDays(e.target.checked)} className="accent-[var(--accent)]" />
            Whole days
          </label>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            {kind === "ooo" ? "From" : "Day"}
            <input
              type="date"
              value={from}
              min={today}
              onChange={(e) => {
                setFrom(e.target.value);
                if (e.target.value > to) setTo(e.target.value);
              }}
              className={`${field} mt-1 w-full`}
            />
          </label>
          {kind === "ooo" ? (
            <label className={label}>
              Until
              <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={`${field} mt-1 w-full`} />
            </label>
          ) : (
            <span />
          )}
          {!wholeDays && (
            <>
              <label className={label}>
                Starts
                <input type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} className={`${field} mt-1 w-full`} />
              </label>
              <label className={label}>
                Ends
                <input type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} className={`${field} mt-1 w-full`} />
              </label>
            </>
          )}
        </div>

        <label className={label}>
          Invitations during this time
          <Select
            value={decline}
            onChange={(v) => setDecline(v as Decline)}
            className={`${field} mt-1 w-full`}
            options={[
              ["new", "Decline new invitations"],
              ["all", "Decline new and existing meetings"],
              ["none", "Don’t decline anything"],
            ]}
          />
        </label>
        {decline !== "none" && (
          <label className={label}>
            Message sent with each decline
            <textarea value={message} maxLength={300} rows={2} onChange={(e) => setMessage(e.target.value)} className={`${field} mt-1 w-full resize-none`} />
          </label>
        )}
        <p className="text-xs text-muted">
          {decline === "none"
            ? "Others see you as busy. Nothing is sent to anyone."
            : `Google will decline ${decline === "all" ? "meetings already on your calendar and new invitations" : "new invitations"} that clash, and send your message to the person who invited you.`}
        </p>
      </div>

      {error && <p className="mt-3 text-sm text-[var(--cat-1)]">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-full border border-line px-4 py-1.5 text-sm hover:border-ink/40">
          Cancel
        </button>
        <button type="button" disabled={busy} onClick={save} className="rounded-full bg-ink px-4 py-1.5 text-sm text-surface hover:bg-ink/85 disabled:opacity-60">
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}
