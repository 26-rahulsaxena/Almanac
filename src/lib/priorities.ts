import { listCalendars, listEvents, type Ev } from "./calendar";
import { sql } from "./db";
import { gcal } from "./google";
import { byPriority, effective, isTracked, suggest, titleKey, WINDOW_DAYS, type Category, type Severity, type Status } from "./priority";
import { midnightIn } from "./reminders";

export type Priority = {
  key: string; // calendarId:eventId
  calendarId: string;
  eventId: string;
  title: string;
  due: string; // ISO instant
  allDay: boolean;
  category: Category;
  suggested: Severity;
  reason: string;
  severity: Severity; // what's shown: your choice, or the suggestion raised by repeated "Later"s
  chosen: Severity | null; // your choice for every event with this name
  manual: boolean | null; // "Show in priorities" / "Hide from priorities"; null = automatic
  status: Status;
  nextCheck: string | null;
  laterCount: number;
};

type State = {
  calendar_id: string;
  event_id: string;
  is_deadline: boolean | null;
  status: Status;
  next_check_at: Date | null;
  later_count: number;
};

// The words of a check-in, shared by the notification and the in-app alert.
export function checkinText(title: string, status: string, due: Date, timeZone: string) {
  const when = due.toLocaleString("en-IN", { timeZone, weekday: "short", hour: "numeric", minute: "2-digit" });
  return {
    ask: (status === "later" ? "start" : "finished") as "start" | "finished",
    title: status === "later" ? `Time to start “${title}”` : `Finished “${title}”?`,
    body: `Due ${when}${status === "stuck" ? " · still stuck? Open Almanac to replan" : ""}`,
  };
}

// All-day items count from the start of that day in the user's time zone, to be safe.
export const dueAt = (e: Pick<Ev, "start" | "allDay">, timeZone: string) => (e.allDay ? midnightIn(e.start, timeZone) : new Date(e.start));

// Everything in the next 5 days from the user's visible calendars, ranked by kind of task and time left.
export async function loadPriorities(userId: string, timeZone: string, hidden: string[], now = new Date()): Promise<Priority[]> {
  const calendars = (await listCalendars(userId)).filter((c) => !hidden.includes(c.id));
  const calendarName = new Map(calendars.map((c) => [c.id, c.name]));
  const [events, states, rules] = await Promise.all([
    listEvents(userId, calendars.map((c) => c.id), now.toISOString(), new Date(+now + WINDOW_DAYS * 86_400_000).toISOString()),
    sql<State[]>`select calendar_id, event_id, is_deadline, status, next_check_at, later_count from deadline_states where user_id = ${userId}`,
    sql<{ title_key: string; severity: Severity }[]>`select title_key, severity from severity_rules where user_id = ${userId}`,
  ]);
  const stateOf = new Map(states.map((s) => [`${s.calendar_id}:${s.event_id}`, s]));
  const ruleOf = new Map(rules.map((r) => [r.title_key, r.severity]));

  return events
    .flatMap((e): Priority[] => {
      const key = `${e.calendarId}:${e.id}`;
      const s = stateOf.get(key);
      const item = { ...e, calendarName: calendarName.get(e.calendarId), guests: e.attendees?.filter((a) => !a.self).length };
      const declined = e.attendees?.find((a) => a.self)?.responseStatus === "declined";
      const due = dueAt(e, timeZone);
      if (declined || due <= now || !isTracked(item, s?.is_deadline ?? null)) return [];
      const { severity, reason, category } = suggest(item, due, now);
      const chosen = ruleOf.get(titleKey(e.title)) ?? null;
      return [
        {
          key,
          calendarId: e.calendarId,
          eventId: e.id,
          title: e.title,
          due: due.toISOString(),
          allDay: e.allDay,
          category,
          suggested: severity,
          reason,
          severity: effective(severity, chosen, s?.later_count ?? 0),
          chosen,
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
  const [row] = await sql<{ id: string; due_at: Date; title: string }[]>`
    insert into deadline_states (user_id, calendar_id, event_id, title, due_at)
    values (${userId}, ${calendarId}, ${eventId}, ${e.summary ?? "(No title)"}, ${due})
    on conflict (user_id, calendar_id, event_id) do update set title = excluded.title, due_at = excluded.due_at, updated_at = now()
    returning id, due_at, title`;
  return row;
}
