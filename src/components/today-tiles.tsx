"use client";

export type Counts = { events: number; minutes: number; unread: number | null; todos: number; overdue: number };
export type TileTarget = "calendar" | "mail" | "todo";

const hours = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`);

// Today at a glance, at the top of Home: events, time booked, unread mail, to-dos due. Each opens where it's from.
// c: the counts (null while loading), read by Home.
export function TodayTiles({ c, onOpen }: { c: Counts | null; onOpen: (t: TileTarget) => void }) {
  const tiles: [TileTarget, string, string, string?][] = [
    ["calendar", c ? String(c.events) : "–", c?.events === 1 ? "event today" : "events today"],
    ["calendar", c ? hours(c.minutes) : "–", "booked today"],
    ["mail", c ? (c.unread === null ? "–" : c.unread >= 500 ? "500+" : String(c.unread)) : "–", c?.unread === null ? "connect Gmail" : "unread emails"],
    ["todo", c ? String(c.todos) : "–", "to-dos due today", c?.overdue ? `${c.overdue} overdue` : undefined],
  ];
  return (
    <ul aria-label="Today at a glance" aria-busy={!c} className="grid grid-cols-2 gap-2 xl:grid-cols-4">
      {tiles.map(([to, value, label, note], i) => (
        <li key={i}>
          <button type="button" onClick={() => onOpen(to)} className="block w-full rounded-2xl border border-line bg-surface px-3 py-2.5 text-left hover:border-ink/40">
            <span className={`block font-serif text-2xl leading-none ${c ? "" : "text-muted"}`}>{value}</span>
            <span className="mt-1 block text-xs text-muted">
              {label}
              {note && <span className="text-accent"> · {note}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
