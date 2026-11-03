// Mirrors one Google Sheet into the user's main calendar: each row becomes one event, linked by a private tag
// (sheet id + row number) stored on the event in Google itself. Read-only on the sheet. New and changed rows are
// written straight away; events whose row is gone are only reported, and deleted when the user confirms.

import { listCalendars } from "./calendar";
import { sql } from "./db";
import { gcal, google, GoogleError } from "./google";
import type { User } from "./planner";
import { MAX_ROWS, parseSheet, type Problem, type SheetRow } from "./sheet";
import { InvalidInput } from "./validate";

const FOOTER = "From your Google Sheet. Edit it in the sheet: changes made here are replaced at the next sync.";

type GEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
  extendedProperties?: { private?: Record<string, string> };
};
export type Orphan = { id: string; title: string; start: string };
export type SyncResult = { title: string; created: number; updated: number; unchanged: number; problems: Problem[]; orphans: Orphan[] };

// The id inside a sheet link (docs.google.com/spreadsheets/d/<id>/edit), or a bare id.
export function sheetIdFrom(s: string) {
  const id = /\/spreadsheets\/d\/([\w-]{20,100})/.exec(s)?.[1] ?? s.trim();
  return /^[\w-]{20,100}$/.test(id) ? id : null;
}

// Turns Google's refusals into steps the user can take.
function explain(err: unknown): never {
  if (err instanceof GoogleError) {
    if (/SERVICE_DISABLED|has not been used|is disabled/.test(err.body))
      throw new InvalidInput("Turn on the Google Sheets API for this app in Google Cloud, wait a minute, then sync again.");
    if (/SCOPE_INSUFFICIENT|insufficient authentication scopes/i.test(err.body))
      throw new InvalidInput("Almanac isn't allowed to read Sheets yet. Sign out, sign back in, and tick the Sheets permission.");
    if (err.status === 404) throw new InvalidInput("That sheet doesn't exist. Check the link.");
    if (err.status === 403) throw new InvalidInput("This Google account can't open that sheet. Use a sheet it owns, or share the sheet with it.");
  }
  throw err;
}

async function readSheet(userId: string, sheetId: string) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
  const meta = await google<{ properties: { title: string }; sheets: { properties: { title: string } }[] }>(
    userId,
    `${base}?fields=properties.title,sheets.properties.title`,
  ).catch(explain);
  const tab = meta.sheets[0].properties.title; // the first tab
  const range = encodeURIComponent(`'${tab.replace(/'/g, "''")}'!A1:Z${MAX_ROWS + 2}`); // header + rows + one to notice overflow
  const { values } = await google<{ values?: (string | number | boolean)[][] }>(
    userId,
    `${base}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`,
  ).catch(explain);
  return { title: meta.properties.title, values: values ?? [] };
}

async function targetCalendar(userId: string) {
  const cals = await listCalendars(userId);
  const cal = cals.find((c) => c.primary && c.canEdit) ?? cals.find((c) => c.canEdit);
  if (!cal) throw new InvalidInput("There's no calendar you can add to.");
  return cal.id;
}

// Every event this sheet created, newest first by Google's order.
async function linkedEvents(userId: string, calendarId: string, sheetId: string) {
  const out: GEvent[] = [];
  let page: string | undefined;
  do {
    const q = new URLSearchParams({
      privateExtendedProperty: `almanacSheet=${sheetId}`,
      maxResults: "2500",
      fields: "items(id,summary,description,location,start,end,extendedProperties),nextPageToken",
      ...(page && { pageToken: page }),
    });
    const r = await gcal<{ items?: GEvent[]; nextPageToken?: string }>(userId, `/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
    out.push(...(r.items ?? []));
    page = r.nextPageToken;
  } while (page);
  return out;
}

const when = (allDay: boolean, v: string) => (allDay ? { date: v } : { dateTime: v });
const same = (a: { date?: string; dateTime?: string }, b: { date?: string; dateTime?: string }) =>
  a.date ? a.date === b.date : !!a.dateTime && !!b.dateTime && +new Date(a.dateTime) === +new Date(b.dateTime);

function eventFor(r: SheetRow, sheetId: string) {
  return {
    summary: r.title,
    location: r.location,
    description: r.notes ? `${r.notes}\n\n${FOOTER}` : FOOTER,
    start: when(r.allDay, r.start),
    end: when(r.allDay, r.end),
    extendedProperties: { private: { almanacSheet: sheetId, almanacRow: String(r.row) } },
  };
}

// Reads the sheet and brings the calendar in line with it. Never deletes: rows that disappeared come back as orphans.
// shortcut: one Google call per new or changed row (fine for a few hundred rows); use batch requests for big sheets.
export async function syncSheet(u: User, sheetId: string): Promise<SyncResult> {
  const { title, values } = await readSheet(u.id, sheetId);
  const { rows, problems } = parseSheet(values, u.timezone);
  const calendarId = await targetCalendar(u.id);
  const existing = await linkedEvents(u.id, calendarId, sheetId);

  // One event per row; any extras (e.g. from two syncs at once) are treated as leftovers.
  const byRow = new Map<string, GEvent>();
  const extras: GEvent[] = [];
  for (const e of existing) {
    const row = e.extendedProperties?.private?.almanacRow ?? "";
    if (byRow.has(row)) extras.push(e);
    else byRow.set(row, e);
  }

  let created = 0;
  let updated = 0;
  const path = `/calendars/${encodeURIComponent(calendarId)}/events`;
  for (const r of rows) {
    const want = eventFor(r, sheetId);
    const e = byRow.get(String(r.row));
    const init = (method: string) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(want) });
    if (!e) {
      await gcal(u.id, path, init("POST"));
      created++;
    } else if (
      e.summary !== want.summary ||
      (e.location ?? "") !== want.location ||
      (e.description ?? "") !== want.description ||
      !same(want.start, e.start) ||
      !same(want.end, e.end)
    ) {
      await gcal(u.id, `${path}/${encodeURIComponent(e.id)}`, init("PATCH"));
      updated++;
    }
  }

  // Rows with a problem keep their event (a typo shouldn't delete anything); only rows that are gone count.
  const present = new Set([...rows, ...problems].map((r) => String(r.row)));
  const orphans = [...extras, ...[...byRow].filter(([row]) => !present.has(row)).map(([, e]) => e)].map((e) => ({
    id: e.id,
    title: e.summary ?? "(No title)",
    start: e.start.dateTime ?? e.start.date ?? "",
  }));
  await sql`update users set sheet_synced_at = now() where id = ${u.id}`;
  return { title, created, updated, unchanged: rows.length - created - updated, problems, orphans };
}

// Acts on leftover events the user chose: delete them, or keep them as ordinary events (unlinked from the sheet).
// Only events this sheet created can be touched.
export async function settleOrphans(u: User, sheetId: string, ids: string[], action: "delete" | "keep") {
  const calendarId = await targetCalendar(u.id);
  const linked = new Set((await linkedEvents(u.id, calendarId, sheetId)).map((e) => e.id));
  const path = `/calendars/${encodeURIComponent(calendarId)}/events`;
  let n = 0;
  for (const id of ids.filter((id) => linked.has(id))) {
    if (action === "delete") await gcal(u.id, `${path}/${encodeURIComponent(id)}?sendUpdates=none`, { method: "DELETE" });
    else {
      await gcal(u.id, `${path}/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extendedProperties: { private: { almanacSheet: "", almanacRow: "" } } }),
      });
    }
    n++;
  }
  return n;
}
