// Reads the rows of a Google Sheet (the template: Title, Date, Start, End, Location, Notes) into events.
// Pure, so it's tested. Cells arrive as Google sends them unformatted: dates and times as spreadsheet serial
// numbers (days since 30 Dec 1899, time as the fraction), or as text when Sheets didn't recognise them.

import { fromLocal } from "./plan";

export type SheetRow = {
  row: number; // the sheet's own row number, which links the row to its calendar event
  title: string;
  allDay: boolean;
  start: string; // ISO instant, or "YYYY-MM-DD" for all-day
  end: string; // all-day: the day after (Google's convention)
  location: string;
  notes: string;
};
export type Problem = { row: number; message: string };
type Cell = string | number | boolean | null | undefined;

export const MAX_ROWS = 500;

// Header names accepted for each column (first row of the sheet, any case).
const HEADERS = {
  title: /^(title|task|event|name|subject|what)$/,
  date: /^(date|day|on)$/,
  start: /^(start|start time|from|time|begins?)$/,
  end: /^(end|end time|to|until|finish|ends?)$/,
  location: /^(location|place|where|room|venue)$/,
  notes: /^(notes?|description|details|comments?)$/,
};
type Col = keyof typeof HEADERS;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function ymd(y: number, m: number, d: number) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

// A date cell → "YYYY-MM-DD". Text dates are read day-first (4/11/2026 is 4 November), as in India.
export function parseDate(v: Cell): string | null {
  if (typeof v === "number") {
    const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000);
    return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  const s = String(v ?? "").trim().toLowerCase().replace(/,/g, " ");
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return ymd(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})$/.exec(s); // 4 Nov 2026
  if (m && MONTHS.includes(m[2])) return ymd(+m[3], MONTHS.indexOf(m[2]) + 1, +m[1]);
  m = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2})\s+(\d{4})$/.exec(s); // Nov 4, 2026
  if (m && MONTHS.includes(m[1])) return ymd(+m[3], MONTHS.indexOf(m[1]) + 1, +m[2]);
  return null;
}

// A time cell → minutes after midnight. Accepts 9:00, 14:30, 9 am, 2:30 pm, or a serial fraction.
export function parseTime(v: Cell): number | null {
  if (typeof v === "number") return Math.round((v - Math.floor(v)) * 1440) % 1440;
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*([ap])?\.?m?\.?$/.exec(String(v ?? "").trim().toLowerCase());
  if (!m) return null;
  let h = +m[1];
  const min = +(m[2] ?? 0);
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3] === "p" ? 12 : 0);
  }
  return h > 23 || min > 59 ? null : h * 60 + min;
}

const blank = (v: Cell) => v == null || String(v).trim() === "";
const text = (v: Cell) => (blank(v) ? "" : String(v).trim());

export function parseSheet(values: Cell[][], timeZone: string): { rows: SheetRow[]; problems: Problem[] } {
  const header = (values[0] ?? []).map((h) => text(h).toLowerCase());
  const col = Object.fromEntries(
    (Object.keys(HEADERS) as Col[]).map((k) => [k, header.findIndex((h) => HEADERS[k].test(h))]),
  ) as Record<Col, number>;
  if (col.title < 0 || col.date < 0) {
    return { rows: [], problems: [{ row: 1, message: "The first row needs column names, at least Title and Date (see the template)." }] };
  }

  const rows: SheetRow[] = [];
  const problems: Problem[] = [];
  const data = values.slice(1);
  if (data.length > MAX_ROWS) problems.push({ row: MAX_ROWS + 2, message: `Only the first ${MAX_ROWS} rows are read.` });

  data.slice(0, MAX_ROWS).forEach((cells, i) => {
    const row = i + 2;
    const get = (k: Col) => (col[k] < 0 ? undefined : cells[col[k]]);
    if ((Object.keys(HEADERS) as Col[]).every((k) => blank(get(k)))) return; // empty row
    const title = text(get("title"));
    if (!title) return problems.push({ row, message: "No title." });
    if (title.length > 300) return problems.push({ row, message: "Title is too long (300 characters at most)." });
    // A Start cell holding a full date and time also counts as the date.
    const startCell = get("start");
    const day = parseDate(blank(get("date")) && typeof startCell === "number" && startCell >= 1 ? startCell : get("date"));
    if (!day) return problems.push({ row, message: blank(get("date")) ? "No date." : `Can't read the date "${text(get("date"))}". Use 2026-11-04 or 4/11/2026.` });
    const base = { row, title, location: text(get("location")).slice(0, 500), notes: text(get("notes")).slice(0, 4000) };

    if (blank(startCell)) {
      const next = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + 1)).toISOString().slice(0, 10);
      return rows.push({ ...base, allDay: true, start: day, end: next });
    }
    const from = parseTime(startCell);
    if (from === null) return problems.push({ row, message: `Can't read the start time "${text(startCell)}". Use 9:00 or 2:30 pm.` });
    const to = blank(get("end")) ? from + 60 : parseTime(get("end"));
    if (to === null) return problems.push({ row, message: `Can't read the end time "${text(get("end"))}". Use 10:00 or 3:30 pm.` });
    if (to % 1440 === from) return problems.push({ row, message: "End time is the same as the start time." });

    const start = fromLocal(`${day}T${pad(Math.floor(from / 60))}:${pad(from % 60)}`, timeZone)!;
    // An end at or before the start runs past midnight (e.g. 11 pm – 1 am).
    const end = new Date(+start + ((to - from + 1440) % 1440 || 1440) * 60_000);
    rows.push({ ...base, allDay: false, start: start.toISOString(), end: end.toISOString() });
  });
  return { rows, problems };
}
