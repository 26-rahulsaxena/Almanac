import { listCalendars, listEvents, type Ev } from "./calendar";
import { sql } from "./db";
import { gcal } from "./google";
import { byPriority, effective, isDeadline, suggest, WINDOW_DAYS, type Severity, type Status } from "./priority";
import { midnightIn } from "./reminders";

export type Priority = {
  key: string; // calendarId:eventId
  calendarId: string;
  eventId: string;
  title: string;
  due: string; // ISO instant
  allDay: boolean;
  suggested: Severity;
  reason: string;
  severity: Severity; // what's shown: your choice, or the suggestion raised by repeated "Later"s
  override: Severity | null;
  manual: boolean | null; // "Track as deadline" / "Not a deadline"; null = automatic
  status: Status;
  nextCheck: string | null;
  laterCount: number;
};

type State = {
  id: string;
  calendar_id: string;
  event_id: string;
  is_deadline: boolean | null;
  severity_override: Severity | null;
  status: Status;
  next_check_at: Date | null;
  later_count: number;
};

// All-day deadlines count from the start of that day in the user's time zone, to be safe.
export const dueAt = (e: Pick<Ev, "start" | "allDay">, timeZone: string) => (e.allDay ? midnightIn(e.start, timeZone) : new Date(e.start));

// Deadlines in the next 5 days from the user's visible calendars, most urgent first.
export async function loadPriorities(userId: string, timeZone: string, hidden: string[], now = new Date()): Promise<Priority[]> {
  const calendars = (await listCalendars(userId)).filter((c) => !hidden.includes(c.id));
  const [events, states] = await Promise.all([
    listEvents(userId, calendars.map((c) => c.id), now.toISOString(), new Date(+now + WINDOW_DAYS * 86_400_000).toISOString()),
    sql<State[]>`select id, calendar_id, event_id, is_deadline, severity_override, status, next_check_at, later_count
                 from deadline_states where user_id = ${userId}`,
  ]);
  const stateOf = new Map(states.map((s) => [`${s.calendar_id}:${s.event_id}`, s]));

  return events
    .flatMap((e): Priority[] => {
      const key = `${e.calendarId}:${e.id}`;
      const s = stateOf.get(key);
      const declined = e.attendees?.find((a) => a.self)?.responseStatus === "declined";
      const due = dueAt(e, timeZone);
      if (declined || due <= now || !isDeadline(e, s?.is_deadline ?? null)) return [];
      const { severity, reason } = suggest(e, due, now);
      return [
        {
          key,
          calendarId: e.calendarId,
          eventId: e.id,
          title: e.title,
          due: due.toISOString(),
          allDay: e.allDay,
          suggested: severity,
          reason,
          severity: effective(severity, s?.severity_override ?? null, s?.later_count ?? 0),
          override: s?.severity_override ?? null,
          manual: s?.is_deadline ?? null,
          status: s?.status ?? "open",
          nextCheck: s?.next_check_at?.toISOString() ?? null,
          laterCount: s?.later_count ?? 0,
        },
      ];
    })
    .sort(byPriority);
}

// Makes sure a state row exists for this event, with its current title and due time read from Google.
export async function ensureState(userId: string, timeZone: string, calendarId: string, eventId: string) {
  const e = await gcal<{ summary?: string; start: { date?: string; dateTime?: string } }>(
    userId,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?fields=summary,start`,
  );
  const due = dueAt({ start: e.start.dateTime ?? e.start.date!, allDay: !e.start.dateTime }, timeZone);
  const [row] = await sql<{ id: string; due_at: Date }[]>`
    insert into deadline_states (user_id, calendar_id, event_id, title, due_at)
    values (${userId}, ${calendarId}, ${eventId}, ${e.summary ?? "(No title)"}, ${due})
    on conflict (user_id, calendar_id, event_id) do update set title = excluded.title, due_at = excluded.due_at, updated_at = now()
    returning id, due_at`;
  return row;
}
