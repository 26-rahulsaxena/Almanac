import { sql } from "./db";
import { gcal, gcalAs, google, ReauthError, rememberCalendars, type GoogleAccount } from "./google";
import type { Attendee, Master, SaveInput } from "./recurrence";
import type { Reminder } from "./reminders";

// account / accountId: the Google account it comes from (its email / Almanac's id). primary: that account's own calendar.
export type Cal = { id: string; name: string; color: string; primary: boolean; canEdit: boolean; defaultReminders: Reminder[]; account: string; accountId: string };
// start/end are "YYYY-MM-DD" for all-day events, otherwise ISO date-times with offset (as Google sends them).
export type Ev = {
  id: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  busy: boolean; // false when Google marks the event "Show as: Free" (e.g. holidays)
  recurringEventId?: string; // set on each occurrence of a repeating event
  originalStart?: string;
  colorId?: string;
  location?: string;
  description?: string;
  attendees?: Attendee[];
  meetLink?: string;
  isOrganizer: boolean; // only the organizer can change guests
  reminders?: Reminder[]; // missing = the calendar's default reminders
  plan?: string; // set on blocks the auto-planner booked: "todo:<id>" or "routine:<id>"
  prep?: string; // set on "Prepare for …" blocks booked from a suggestion: the deadline's "<calendarId>:<eventId>"
  away?: "ooo" | "focus"; // out of office or focus time (Google's own kind, or Almanac's busy block on personal Gmail)
  done?: boolean; // in the browser only: ticked Done, so the views draw a line through it
};

type GCal = {
  id: string;
  summary: string;
  summaryOverride?: string;
  backgroundColor: string;
  primary?: boolean;
  accessRole: string;
  defaultReminders?: Reminder[];
};
type GTime = { date?: string; dateTime?: string };
type GEvent = {
  id: string;
  iCalUID?: string; // the same in every calendar the meeting is on
  summary?: string;
  description?: string;
  start: GTime;
  end: GTime;
  recurringEventId?: string;
  originalStartTime?: GTime;
  location?: string;
  transparency?: string;
  colorId?: string;
  attendees?: Attendee[];
  hangoutLink?: string;
  organizer?: { self?: boolean };
  reminders?: { useDefault?: boolean; overrides?: Reminder[] };
  extendedProperties?: { private?: Record<string, string> };
  eventType?: string;
};

// Google Tasks (the tasks Google Calendar shows beside events) live in a separate Google service. Each account that
// allowed it gets one calendar, "Tasks" (id "tasks~<account id>"), whose events are its tasks with a due date, on
// that date, all day: the Tasks API keeps the date only, never a time. Each is "<list id>~<task id>". It can be
// changed when the account allowed full Tasks access (older sign-ins allowed reading only).
// Completed ones show crossed out (done), as in Google Calendar, and aren't priorities.
export const TASKS = "tasks~";
const TASKS_API = "https://tasks.googleapis.com/tasks/v1";
type GTask = { id: string; title?: string; notes?: string; due?: string; status?: string };

export function taskEvent(t: GTask, list: string, calendarId: string): Ev {
  const day = t.due!.slice(0, 10); // Google keeps the date as midnight UTC
  return {
    id: `${list}~${t.id}`,
    calendarId,
    title: t.title || "(No title)",
    start: day,
    end: new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10),
    allDay: true,
    busy: false,
    description: t.notes,
    isOrganizer: false,
    ...(t.status === "completed" && { done: true }),
  };
}

// One account's open tasks due in the range (a day either side, as due dates are UTC midnights), from all its lists.
async function listTasks(userId: string, calendarId: string, from: string, to: string, query?: string): Promise<Ev[]> {
  const lists = await google<{ items?: { id: string }[] }>(userId, `${TASKS_API}/users/@me/lists?maxResults=100&fields=items(id)`, undefined, calendarId);  const q = new URLSearchParams({
    dueMin: new Date(Date.parse(from) - 86_400_000).toISOString(),
    dueMax: new Date(Date.parse(to) + 86_400_000).toISOString(),
    showCompleted: "true",
    showHidden: "true", // completed in Google's own apps hides a task from the API unless asked for
    maxResults: "100", // shortcut: no paging, so a list with >100 tasks due in one range gets cut off; loop on nextPageToken if that happens
    fields: "items(id,title,notes,due,status)",
  });
  const all = await Promise.all(
    (lists.items ?? []).map(async (l) => {
      const r = await google<{ items?: GTask[] }>(userId, `${TASKS_API}/lists/${encodeURIComponent(l.id)}/tasks?${q}`, undefined, calendarId);      return (r.items ?? []).filter((t) => t.due).map((t) => taskEvent(t, l.id, calendarId));
    }),
  );
  const words = query?.toLowerCase();
  return all.flat().filter((e) => !words || `${e.title} ${e.description ?? ""}`.toLowerCase().includes(words));
}

// One task as the summary and start of an event (for a priority's state; see priorities.ts).
export async function getTask(userId: string, calendarId: string, id: string): Promise<{ summary?: string; start: { date?: string; dateTime?: string } }> {
  const [list, task] = id.split("~");
  const t = await google<GTask>(userId, `${TASKS_API}/lists/${encodeURIComponent(list)}/tasks/${encodeURIComponent(task)}?fields=id,title,due`, undefined, calendarId);
  return { summary: t.title, start: { date: (t.due ?? new Date().toISOString()).slice(0, 10) } };
}

const taskUrl = (id: string) => {
  const [list, task] = id.split("~");
  return `${TASKS_API}/lists/${encodeURIComponent(list)}/tasks/${encodeURIComponent(task)}`;
};
const json = (method: string, body: object): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const status = (done: boolean) => (done ? { status: "completed" } : { status: "needsAction", completed: null });

// Creates (in the account's default list) or edits a task. Only the title, notes, day and done carry over.
export async function saveTask(userId: string, t: SaveInput) {
  const body = {
    title: t.title,
    notes: t.description,
    due: `${t.start.slice(0, 10)}T00:00:00.000Z`, // the day as picked (a timed start is local, so its date part is too)
    ...(t.done !== undefined && status(t.done)),
  };
  if (t.id) await google(userId, taskUrl(t.id), json("PATCH", body), t.calendarId);
  else await google(userId, `${TASKS_API}/lists/@default/tasks`, json("POST", body), t.calendarId);
}

export const deleteTask = (userId: string, calendarId: string, id: string) => google(userId, taskUrl(id), { method: "DELETE" }, calendarId);

// Ticking a task Done in Priorities completes it in Google too (and reopening it, the reverse).
export async function setTaskDone(userId: string, calendarId: string, id: string, done: boolean) {
  if (calendarId.startsWith(TASKS)) await google(userId, taskUrl(id), json("PATCH", status(done)), calendarId);
}

// Every calendar from every connected Google account: the main account's first, each account's own calendar first
// within it, then its Tasks. A calendar shared with two of the accounts shows once, from one that can change it.
export async function listCalendars(userId: string): Promise<Cal[]> {
  const accounts = await sql<(GoogleAccount & { email: string; tasks: boolean; edit_tasks: boolean })[]>`
    select id, email, is_main as main, coalesce(scope like '%/auth/tasks%', false) as tasks,
      coalesce(scope ~ '/auth/tasks( |$)', false) as edit_tasks
    from google_accounts where user_id = ${userId} order by is_main desc, created_at`;
  if (!accounts[0]?.main) throw new ReauthError();
  const lists = await Promise.all(
    accounts.map(async (a) => {
      try {
        const data = await gcalAs<{ items: GCal[] }>(a, "/users/me/calendarList?fields=items(id,summary,summaryOverride,backgroundColor,primary,accessRole,defaultReminders)");
        const cals: Cal[] = data.items
          .map((c) => ({
            id: c.id,
            name: c.summaryOverride ?? c.summary,
            color: c.backgroundColor,
            primary: !!c.primary,
            canEdit: c.accessRole === "owner" || c.accessRole === "writer",
            defaultReminders: c.defaultReminders ?? [],
            account: a.email,
            accountId: a.id,
          }))
          .sort((x, y) => Number(y.primary) - Number(x.primary));
        if (a.tasks) cals.push({ id: TASKS + a.id, name: "Tasks", color: "#4285f4", primary: false, canEdit: a.edit_tasks, defaultReminders: [], account: a.email, accountId: a.id });
        return cals;
      } catch (err) {
        if (a.main) throw err;
        console.error(`Skipping Google account ${a.id}:`, err); // an added account that needs reconnecting
        return [];
      }
    }),
  );
  const byId = new Map<string, Cal>();
  for (const c of lists.flat()) if (!byId.has(c.id) || (c.canEdit && !byId.get(c.id)!.canEdit)) byId.set(c.id, c);
  const cals = [...byId.values()];
  await rememberCalendars(userId, cals);
  return cals;
}

// Fetches live from Google (nothing is stored). singleEvents=true makes Google expand recurring events for us.
// With a search query, Google matches title, description, location and attendees; we take the first 50 per calendar.
export async function listEvents(userId: string, calendarIds: string[], from: string, to: string, query?: string): Promise<Ev[]> {
  const q = new URLSearchParams({
    timeMin: from,
    timeMax: to,
    singleEvents: "true",
    orderBy: "startTime",
    // shortcut: no paging, so >2500 events per calendar in one range get cut off; add nextPageToken looping if ranges grow beyond ~2 months.
    maxResults: query ? "50" : "2500",
    fields:
      "items(id,iCalUID,summary,description,start,end,recurringEventId,originalStartTime,location,transparency,colorId," +
      "attendees(email,displayName,responseStatus,self,organizer),hangoutLink,organizer(self),reminders,extendedProperties(private),eventType)",
  });
  if (query) q.set("q", query);
  const lists = await Promise.all(
    calendarIds.map(async (calendarId) => {
      try {
        if (calendarId.startsWith(TASKS)) return (await listTasks(userId, calendarId, from, to, query)).map((e): [undefined, Ev] => [undefined, e]);
        const data = await gcal<{ items: GEvent[] }>(userId, `/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
        return data.items.map((e): [string | undefined, Ev] => [
          e.iCalUID,
          {
            id: e.id,
            calendarId,
            title: e.summary ?? "(No title)",
            start: e.start.dateTime ?? e.start.date!,
            end: e.end.dateTime ?? e.end.date!,
            allDay: !e.start.dateTime,
            // Free if Google says "Show as: Free" or you declined the invite.
            busy: e.transparency !== "transparent" && e.attendees?.find((a) => a.self)?.responseStatus !== "declined",
            recurringEventId: e.recurringEventId,
            originalStart: e.originalStartTime?.dateTime ?? e.originalStartTime?.date,
            colorId: e.colorId,
            location: e.location,
            description: e.description,
            attendees: e.attendees,
            meetLink: e.hangoutLink,
            isOrganizer: e.organizer?.self ?? true,
            reminders: e.reminders?.useDefault === false ? (e.reminders.overrides ?? []) : undefined,
            plan: e.extendedProperties?.private?.almanacPlan || undefined,
            prep: e.extendedProperties?.private?.almanacPrep || undefined,
            away: awayOf(e),
          },
        ]);
      } catch (err) {
        if (err instanceof ReauthError) throw err;
        console.error(`Skipping calendar ${calendarId}:`, err); // one broken calendar shouldn't blank the whole view
        return [];
      }
    }),
  );
  return oneEach(lists.flat());
}

// A meeting on two of your calendars (say, invited at work and at home) is one event: keep the copy you organise,
// else the one from the calendar listed first. Same meeting = same iCalUID and (for a repeating one) same occurrence.
export function oneEach(events: [string | undefined, Ev][]): Ev[] {
  const kept = new Map<string, number>();
  const out: Ev[] = [];
  for (const [uid, e] of events) {
    const key = uid && `${uid} ${e.originalStart ?? e.start}`;
    const at = key ? kept.get(key) : undefined;
    if (at === undefined) {
      if (key) kept.set(key, out.length);
      out.push(e);
    } else if (e.isOrganizer && !out[at].isOrganizer) out[at] = e;
  }
  return out;
}

// The series ("master") event behind a repeating event: its first start/end, repeat rules and Meet details.
export function getMaster(userId: string, calendarId: string, id: string) {
  return gcal<Master>(
    userId,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}?fields=start,end,recurrence,conferenceData`,
  );
}

// Out of office / focus time: Google's own kinds (work or school accounts), or the busy block Almanac makes on personal Gmail.
function awayOf(e: GEvent): Ev["away"] {
  const tag = e.extendedProperties?.private?.almanacAway;
  if (e.eventType === "outOfOffice" || tag === "ooo") return "ooo";
  if (e.eventType === "focusTime" || tag === "focus") return "focus";
}
