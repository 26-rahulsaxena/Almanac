import type { DeleteInput, SaveInput, Scope } from "./recurrence";

// Checks everything the browser sends before it reaches Google. Messages are shown to the user.
export class InvalidInput extends Error {}

type Body = Record<string, unknown>;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RRULE = /^RRULE:[A-Z]+=[A-Z0-9,+-]+(?:;[A-Z]+=[A-Z0-9,+-]+)*$/;

function str(o: Body, key: string, max: number): string;
function str(o: Body, key: string, max: number, optional: true): string | undefined;
function str(o: Body, key: string, max: number, optional = false) {
  const v = o[key];
  if (v === undefined || v === null || v === "") {
    if (optional) return undefined;
    throw new InvalidInput(`${key} is required`);
  }
  if (typeof v !== "string" || v.length > max) throw new InvalidInput(`${key} is invalid`);
  return v;
}

function asBody(v: unknown): Body {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new InvalidInput("Invalid request");
  return v as Body;
}

function when(v: string, allDay: boolean) {
  if (DATE.test(v) !== allDay || isNaN(+new Date(v))) throw new InvalidInput("Invalid date or time");
  return v;
}

function target(o: Body) {
  const scope = str(o, "scope", 10, true);
  if (scope && !["this", "following", "all"].includes(scope)) throw new InvalidInput("Invalid choice of events");
  const t = {
    calendarId: str(o, "calendarId", 300),
    id: str(o, "id", 1024, true),
    recurringEventId: str(o, "recurringEventId", 1024, true),
    originalStart: str(o, "originalStart", 40, true),
    scope: scope as Scope | undefined,
    allDay: o.allDay === true,
  };
  if (t.recurringEventId && (!t.id || !t.scope || !t.originalStart)) throw new InvalidInput("Choose which events to change");
  return t;
}

export function parseSave(raw: unknown): SaveInput {
  const o = asBody(raw);
  const t = target(o);
  const start = when(str(o, "start", 40), t.allDay);
  const end = when(str(o, "end", 40), t.allDay);
  const span = +new Date(end) - +new Date(start);
  if (span <= 0) throw new InvalidInput("End must be after start");
  if (span > 366 * 86_400_000) throw new InvalidInput("Events can't be longer than a year");

  const timeZone = str(o, "timeZone", 64);
  try {
    new Intl.DateTimeFormat("en", { timeZone });
  } catch {
    throw new InvalidInput("Invalid time zone");
  }
  const colorId = str(o, "colorId", 2, true) ?? null;
  if (colorId && !/^(?:[1-9]|1[01])$/.test(colorId)) throw new InvalidInput("Invalid category");
  const recurrence = str(o, "recurrence", 300, true) ?? null;
  if (recurrence && !RRULE.test(recurrence)) throw new InvalidInput("Invalid repeat rule");

  return {
    ...t,
    title: (str(o, "title", 300, true) ?? "").trim(),
    start,
    end,
    timeZone,
    location: str(o, "location", 500, true) ?? "",
    description: str(o, "description", 8000, true) ?? "",
    colorId,
    recurrence,
  };
}

export function parseDelete(raw: unknown): DeleteInput {
  const t = target(asBody(raw));
  if (!t.id) throw new InvalidInput("id is required");
  return { ...t, id: t.id };
}
