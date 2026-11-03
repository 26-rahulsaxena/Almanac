"use client";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Cal, Ev } from "@/lib/calendar";
import { CATEGORIES } from "@/lib/categories";
import {
  fromPreset,
  NO_REPEAT,
  parseRRule,
  presetOf,
  shiftDate,
  toRRule,
  ymd,
  type Freq,
  type Preset,
  type Repeat,
  type SaveInput,
  type Scope,
} from "@/lib/recurrence";
import { addDays, parseWhen } from "@/lib/time";
import { useDialog } from "./use-dialog";

export type Form = {
  calendarId: string;
  title: string;
  allDay: boolean;
  date: string;
  startTime: string;
  endDate: string; // inclusive for all-day events
  endTime: string;
  location: string;
  description: string;
  colorId: string | null;
  preset: Preset;
  custom: Repeat;
};

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function draftFromSlot(start: Date, end: Date, calendarId: string): Form {
  return {
    calendarId,
    title: "",
    allDay: false,
    date: ymd(start),
    startTime: hhmm(start),
    endDate: ymd(end),
    endTime: hhmm(end),
    location: "",
    description: "",
    colorId: null,
    preset: "none",
    custom: NO_REPEAT,
  };
}

export function draftFromEvent(e: Ev): Form {
  const s = parseWhen(e.start, e.allDay);
  const en = parseWhen(e.end, e.allDay);
  return {
    calendarId: e.calendarId,
    title: e.title === "(No title)" ? "" : e.title,
    allDay: e.allDay,
    date: ymd(s),
    startTime: hhmm(s),
    endDate: ymd(e.allDay ? addDays(en, -1) : en),
    endTime: hhmm(en),
    location: e.location ?? "",
    description: e.description ?? "",
    colorId: e.colorId ?? null,
    preset: "none",
    custom: NO_REPEAT,
  };
}

type Props = {
  initial: Form;
  event?: Ev;
  calendars: Cal[];
  onClose: () => void;
  onSave: (input: SaveInput) => Promise<void>;
  onDelete: (scope?: Scope) => void;
};

const field = "w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm focus:border-ink/40 focus:outline-none";
const label = "font-mono text-[10px] uppercase tracking-[0.18em] text-muted";

export function EventPanel({ initial, event, calendars, onClose, onSave, onDelete }: Props) {
  const [f, setF] = useState(initial);
  // undefined while the series rule loads; null when the event doesn't repeat
  const [originalRule, setOriginalRule] = useState<string | null | undefined>(event?.recurringEventId ? undefined : null);
  const [ask, setAsk] = useState<"save" | "delete" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useDialog<HTMLDivElement>(onClose);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const cal = calendars.find((c) => c.id === f.calendarId);
  const readOnly = !cal?.canEdit;
  const startDate = new Date(`${f.date}T${f.allDay ? "00:00" : f.startTime}`);
  const rule = toRRule(fromPreset(f.preset, startDate, f.custom), f.allDay);
  const phone = window.matchMedia("(max-width: 639px)").matches;

  useEffect(() => {
    if (!event?.recurringEventId) return;
    const q = new URLSearchParams({ master: event.recurringEventId, cal: event.calendarId });
    fetch(`/api/events?${q}`)
      .then((r) => r.json())
      .then((m: { recurrence?: string[] }) => {
        const line = m.recurrence?.find((l) => l.startsWith("RRULE:")) ?? null;
        const r = parseRRule(line);
        setOriginalRule(line);
        setF((x) => ({ ...x, preset: presetOf(r, parseWhen(event.start, event.allDay)), custom: r }));
      })
      .catch(() => setError("Couldn't load how this event repeats."));
  }, [event]);

  function build(scope?: Scope): SaveInput | string {
    const start = f.allDay ? f.date : startDate.toISOString();
    const end = f.allDay ? shiftDate(f.endDate, 1) : new Date(`${f.endDate}T${f.endTime}`).toISOString();
    if (f.allDay ? f.endDate < f.date : +new Date(end) <= +startDate) return "End must be after start.";
    return {
      calendarId: f.calendarId,
      id: event?.id,
      recurringEventId: event?.recurringEventId,
      originalStart: event?.originalStart,
      scope,
      title: f.title.trim(),
      allDay: f.allDay,
      start,
      end,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      location: f.location,
      description: f.description,
      colorId: f.colorId,
      recurrence: rule,
    };
  }

  async function save(scope?: Scope) {
    const input = build(scope);
    if (typeof input === "string") return setError(input);
    if (event?.recurringEventId && !scope) return setAsk("save");
    setAsk(null);
    setSaving(true);
    setError(null);
    try {
      await onSave(input);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <>
      <motion.div
        className="fixed inset-0 z-40 bg-ink/25 backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="panel-title"
        initial={phone ? { y: "100%" } : { x: "100%" }}
        animate={{ x: 0, y: 0 }}
        exit={phone ? { y: "100%" } : { x: "100%" }}
        transition={{ type: "spring", damping: 34, stiffness: 340 }}
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-3xl border border-line bg-surface shadow-2xl sm:inset-y-0 sm:left-auto sm:max-h-none sm:w-[27rem] sm:rounded-none sm:rounded-l-3xl"
      >
        <div className="h-1.5 shrink-0 rounded-t-3xl sm:rounded-tl-3xl sm:rounded-tr-none" style={{ background: CATEGORIES.find((c) => c.id === f.colorId)?.hex ?? cal?.color }} />
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 id="panel-title" className={label}>
            {readOnly ? "Event" : event ? "Edit event" : "New event"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-full hover:bg-ink/5">
            ✕
          </button>
        </div>

        <form
          className="flex min-h-0 flex-1 flex-col"
          inert={!!ask}
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <fieldset disabled={readOnly || saving} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pb-5">
            <input
              data-autofocus
              aria-label="Title"
              value={f.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Add a title"
              maxLength={300}
              className="w-full bg-transparent font-serif text-3xl placeholder:text-muted/60 focus:outline-none"
            />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className={label}>When</span>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={f.allDay} onChange={(e) => set("allDay", e.target.checked)} className="accent-[var(--accent)]" />
                  All day
                </label>
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input type="date" aria-label="Start date" value={f.date} onChange={(e) => setF((x) => ({ ...x, date: e.target.value, endDate: e.target.value > x.endDate ? e.target.value : x.endDate }))} className={field} required />
                {!f.allDay && <input type="time" aria-label="Start time" value={f.startTime} onChange={(e) => set("startTime", e.target.value)} className={field} required />}
                <input type="date" aria-label="End date" value={f.endDate} min={f.date} onChange={(e) => set("endDate", e.target.value)} className={field} required />
                {!f.allDay && <input type="time" aria-label="End time" value={f.endTime} onChange={(e) => set("endTime", e.target.value)} className={field} required />}
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="repeat" className={label}>
                Repeat
              </label>
              <select
                id="repeat"
                value={f.preset}
                disabled={originalRule === undefined}
                onChange={(e) => {
                  const p = e.target.value as Preset;
                  setF((x) => ({ ...x, preset: p, custom: p === "custom" && !x.custom.freq ? fromPreset("weekly", startDate, x.custom) : x.custom }));
                }}
                className={field}
              >
                <option value="none">Does not repeat</option>
                <option value="daily">Every day</option>
                <option value="weekly">Every week on {startDate.toLocaleDateString("en-IN", { weekday: "long" })}</option>
                <option value="weekdays">Every weekday (Mon–Fri)</option>
                <option value="monthly">Every month on day {startDate.getDate()}</option>
                <option value="yearly">Every year on {startDate.toLocaleDateString("en-IN", { day: "numeric", month: "long" })}</option>
                <option value="custom">Custom…</option>
              </select>
              {f.preset === "custom" && <CustomRepeat value={f.custom} onChange={(r) => set("custom", r)} />}
            </div>

            <div className="space-y-2">
              <span className={label}>Category</span>
              <div role="radiogroup" aria-label="Category" className="flex flex-wrap gap-2">
                <Swatch checked={!f.colorId} color={cal?.color ?? "var(--muted)"} name="No category" onClick={() => set("colorId", null)} />
                {CATEGORIES.map((c) => (
                  <Swatch key={c.id} checked={f.colorId === c.id} color={c.hex} name={c.name} onClick={() => set("colorId", c.id)} />
                ))}
              </div>
              <p className="text-xs text-muted">{CATEGORIES.find((c) => c.id === f.colorId)?.name ?? "No category: uses the calendar's colour"}</p>
            </div>

            <div className="space-y-2">
              <label htmlFor="cal" className={label}>
                Calendar
              </label>
              {event ? (
                <p className="flex items-center gap-2 text-sm">
                  <span className="size-3 rounded-full" style={{ background: cal?.color }} />
                  {cal?.name}
                  {readOnly && <span className="text-muted">· read-only</span>}
                </p>
              ) : (
                <select id="cal" value={f.calendarId} onChange={(e) => set("calendarId", e.target.value)} className={field}>
                  {calendars
                    .filter((c) => c.canEdit)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="loc" className={label}>
                Location
              </label>
              <input id="loc" value={f.location} onChange={(e) => set("location", e.target.value)} maxLength={500} className={field} placeholder="Add a place" />
            </div>
            <div className="space-y-2">
              <label htmlFor="notes" className={label}>
                Notes
              </label>
              <textarea id="notes" value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={8000} rows={3} className={field} />
            </div>
          </fieldset>

          {error && (
            <p role="alert" className="mx-5 mb-3 rounded-lg bg-accent/10 px-3 py-2 text-sm">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2 border-t border-line px-5 py-4">
            {event && !readOnly && (
              <button type="button" onClick={() => setAsk("delete")} className="rounded-full px-4 py-2 text-sm text-accent hover:bg-accent/10">
                Delete
              </button>
            )}
            <span className="flex-1" />
            <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-sm hover:bg-ink/5">
              {readOnly ? "Close" : "Cancel"}
            </button>
            {!readOnly && (
              <motion.button
                type="submit"
                disabled={saving || originalRule === undefined}
                whileTap={{ scale: 0.96 }}
                className="rounded-full bg-ink px-5 py-2 text-sm font-medium text-paper disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </motion.button>
            )}
          </div>
        </form>

        {ask && (
          <Confirm
            action={ask}
            title={f.title.trim() || "(No title)"}
            recurring={!!event?.recurringEventId}
            // Changing the repeat rule can't apply to a single occurrence.
            allowThis={ask === "delete" || rule === originalRule}
            onCancel={() => setAsk(null)}
            onConfirm={(scope) => (ask === "save" ? save(scope) : onDelete(scope))}
          />
        )}
      </motion.div>
    </>
  );
}

function Swatch({ checked, color, name, onClick }: { checked: boolean; color: string; name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={name}
      title={name}
      onClick={onClick}
      className={`size-7 rounded-full ring-offset-2 ring-offset-surface transition-transform hover:scale-110 ${checked ? "ring-2 ring-ink" : ""}`}
      style={{ background: color }}
    />
  );
}

const FREQS: [Freq, string][] = [
  ["DAILY", "day(s)"],
  ["WEEKLY", "week(s)"],
  ["MONTHLY", "month(s)"],
  ["YEARLY", "year(s)"],
];
const DAYS: [string, string][] = [
  ["MO", "M"],
  ["TU", "T"],
  ["WE", "W"],
  ["TH", "T"],
  ["FR", "F"],
  ["SA", "S"],
  ["SU", "S"],
];

function CustomRepeat({ value: r, onChange }: { value: Repeat; onChange: (r: Repeat) => void }) {
  if (r.raw) {
    return (
      <p className="rounded-lg border border-line p-3 text-sm text-muted">
        This uses a repeat pattern set in Google ({r.raw.replace("RRULE:", "")}), kept as it is.{" "}
        <button type="button" onClick={() => onChange({ ...r, raw: undefined })} className="text-ink underline">
          Change it here
        </button>
      </p>
    );
  }
  const small = "rounded-md border border-line bg-paper px-2 py-1";
  return (
    <div className="space-y-3 rounded-lg border border-line p-3 text-sm">
      <div className="flex items-center gap-2">
        Every
        <input
          type="number"
          aria-label="Repeat every"
          min={1}
          max={99}
          value={r.interval}
          onChange={(e) => onChange({ ...r, interval: Math.min(99, Math.max(1, Number(e.target.value) || 1)) })}
          className={`${small} w-16`}
        />
        <select aria-label="Repeat unit" value={r.freq ?? "WEEKLY"} onChange={(e) => onChange({ ...r, freq: e.target.value as Freq })} className={small}>
          {FREQS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      {r.freq === "WEEKLY" && (
        <div role="group" aria-label="On days" className="flex gap-1">
          {DAYS.map(([code, l]) => {
            const on = r.byDay.includes(code);
            return (
              <button
                key={code}
                type="button"
                aria-pressed={on}
                aria-label={code}
                onClick={() => onChange({ ...r, byDay: on ? r.byDay.filter((d) => d !== code) : [...r.byDay, code] })}
                className={`grid size-8 place-items-center rounded-full text-xs ${on ? "bg-ink text-paper" : "border border-line"}`}
              >
                {l}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        Ends
        <select aria-label="Ends" value={r.ends} onChange={(e) => onChange({ ...r, ends: e.target.value as Repeat["ends"] })} className={small}>
          <option value="never">never</option>
          <option value="until">on</option>
          <option value="count">after</option>
        </select>
        {r.ends === "until" && <input type="date" aria-label="End repeat on" value={r.until} onChange={(e) => onChange({ ...r, until: e.target.value })} className={small} required />}
        {r.ends === "count" && (
          <>
            <input
              type="number"
              aria-label="Number of times"
              min={1}
              max={999}
              value={r.count}
              onChange={(e) => onChange({ ...r, count: Math.min(999, Math.max(1, Number(e.target.value) || 1)) })}
              className={`${small} w-20`}
            />
            times
          </>
        )}
      </div>
    </div>
  );
}

function Confirm({
  action,
  title,
  recurring,
  allowThis,
  onCancel,
  onConfirm,
}: {
  action: "save" | "delete";
  title: string;
  recurring: boolean;
  allowThis: boolean;
  onCancel: () => void;
  onConfirm: (scope?: Scope) => void;
}) {
  const [scope, setScope] = useState<Scope>(allowThis ? "this" : "following");
  const ref = useDialog<HTMLDivElement>(onCancel);
  const options: [Scope, string][] = [
    ["this", "This event"],
    ["following", "This and following events"],
    ["all", "All events"],
  ];
  return (
    <div className="absolute inset-0 z-10 grid place-items-center rounded-l-3xl bg-surface/70 p-6 backdrop-blur-sm">
      <motion.div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", damping: 24, stiffness: 400 }}
        className="w-full max-w-xs rounded-2xl border border-line bg-surface p-5 shadow-xl"
      >
        <h3 id="confirm-title" className="font-serif text-2xl">
          {recurring ? (action === "save" ? "Edit repeating event" : "Delete repeating event") : `Delete “${title}”?`}
        </h3>
        {recurring ? (
          <fieldset className="mt-4 space-y-2 text-sm">
            <legend className="sr-only">Which events?</legend>
            {options.map(([v, l]) => (
              <label key={v} className={`flex items-center gap-2 ${v === "this" && !allowThis ? "opacity-40" : ""}`}>
                <input type="radio" name="scope" value={v} checked={scope === v} disabled={v === "this" && !allowThis} onChange={() => setScope(v)} className="accent-[var(--accent)]" />
                {l}
              </label>
            ))}
            {!allowThis && <p className="text-xs text-muted">A new repeat pattern can&apos;t apply to just one event.</p>}
          </fieldset>
        ) : (
          <p className="mt-2 text-sm text-muted">You&apos;ll have a few seconds to undo.</p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-full px-4 py-2 text-sm hover:bg-ink/5">
            Cancel
          </button>
          <button
            type="button"
            data-autofocus
            onClick={() => onConfirm(recurring ? scope : undefined)}
            className={`rounded-full px-4 py-2 text-sm font-medium text-paper ${action === "delete" ? "bg-accent" : "bg-ink"}`}
          >
            {action === "delete" ? "Delete" : "Save"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
