import { gcal, ReauthError } from "./google";

export type Cal = { id: string; name: string; color: string; primary: boolean; canEdit: boolean };
// start/end are "YYYY-MM-DD" for all-day events, otherwise ISO date-times with offset (as Google sends them).
export type Ev = {
  id: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  busy: boolean; // false when Google marks the event "Show as: Free" (e.g. holidays)
  recurring: boolean;
  location?: string;
};

type GCal = { id: string; summary: string; summaryOverride?: string; backgroundColor: string; primary?: boolean; accessRole: string };
type GTime = { date?: string; dateTime?: string };
type GEvent = {
  id: string;
  summary?: string;
  start: GTime;
  end: GTime;
  recurringEventId?: string;
  location?: string;
  transparency?: string;
};

export async function listCalendars(userId: string): Promise<Cal[]> {
  const data = await gcal<{ items: GCal[] }>(
    userId,
    "/users/me/calendarList?fields=items(id,summary,summaryOverride,backgroundColor,primary,accessRole)",
  );
  return data.items
    .map((c) => ({
      id: c.id,
      name: c.summaryOverride ?? c.summary,
      color: c.backgroundColor,
      primary: !!c.primary,
      canEdit: c.accessRole === "owner" || c.accessRole === "writer",
    }))
    .sort((a, b) => Number(b.primary) - Number(a.primary));
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
    fields: "items(id,summary,start,end,recurringEventId,location,transparency)",
  });
  if (query) q.set("q", query);
  const lists = await Promise.all(
    calendarIds.map(async (calendarId) => {
      try {
        const data = await gcal<{ items: GEvent[] }>(userId, `/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
        return data.items.map(
          (e): Ev => ({
            id: e.id,
            calendarId,
            title: e.summary ?? "(No title)",
            start: e.start.dateTime ?? e.start.date!,
            end: e.end.dateTime ?? e.end.date!,
            allDay: !e.start.dateTime,
            busy: e.transparency !== "transparent",
            recurring: !!e.recurringEventId,
            location: e.location,
          }),
        );
      } catch (err) {
        if (err instanceof ReauthError) throw err;
        console.error(`Skipping calendar ${calendarId}:`, err); // one broken calendar shouldn't blank the whole view
        return [];
      }
    }),
  );
  return lists.flat();
}
