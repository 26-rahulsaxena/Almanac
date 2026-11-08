// "Out of office" and "Focus time": blocks that tell others you're not available. On work or school (Workspace)
// accounts they're Google's own kinds, which show your status to others and can decline clashing invitations
// with your message. Personal Gmail can't make those (Google answers 400), so there they become a plain busy
// block, tagged so Almanac still knows what it is.
import { InvalidInput } from "./validate";

export type AwayKind = "ooo" | "focus";
export type Decline = "none" | "new" | "all";
export type AwayInput = { kind: AwayKind; start: Date; end: Date; decline: Decline; message: string };

export const AWAY_TITLE: Record<AwayKind, string> = { ooo: "Out of office", focus: "Focus time" };
const MAX_MS: Record<AwayKind, number> = { ooo: 60 * 86_400_000, focus: 12 * 3_600_000 };
const DECLINE_MODE: Record<Decline, string> = {
  none: "declineNone",
  new: "declineOnlyNewConflictingInvitations",
  all: "declineAllConflictingInvitations",
};

// Checks what the browser sent: a known kind, a real time range that hasn't ended and isn't too long, a short message.
export function parseAway(raw: unknown, now = new Date()): AwayInput {
  const b = (raw ?? {}) as Record<string, unknown>;
  const kind = b.kind === "ooo" || b.kind === "focus" ? b.kind : null;
  const decline = b.decline === "none" || b.decline === "new" || b.decline === "all" ? b.decline : null;
  const start = new Date(typeof b.start === "string" ? b.start : NaN);
  const end = new Date(typeof b.end === "string" ? b.end : NaN);
  const message = typeof b.message === "string" ? b.message.trim() : "";
  if (!kind || !decline) throw new InvalidInput("Invalid request");
  if (isNaN(+start) || isNaN(+end) || end <= start) throw new InvalidInput("The end has to be after the start.");
  if (end <= now) throw new InvalidInput("That time has already passed.");
  if (+end - +start > MAX_MS[kind]) throw new InvalidInput(kind === "ooo" ? "Out of office can be up to 60 days at a time." : "Focus time can be up to 12 hours.");
  if (message.length > 300) throw new InvalidInput("Keep the message under 300 characters.");
  return { kind, start, end, decline, message };
}

const when = (i: AwayInput) => ({ start: { dateTime: i.start.toISOString() }, end: { dateTime: i.end.toISOString() } });
const tag = (kind: AwayKind) => ({ extendedProperties: { private: { almanacAway: kind } } });

// Google's own out-of-office / focus time event (work or school accounts).
export function statusEvent(i: AwayInput) {
  const props = { autoDeclineMode: DECLINE_MODE[i.decline], ...(i.decline !== "none" && i.message && { declineMessage: i.message }) };
  return {
    summary: AWAY_TITLE[i.kind],
    transparency: "opaque",
    ...when(i),
    ...tag(i.kind),
    ...(i.kind === "ooo" ? { eventType: "outOfOffice", outOfOfficeProperties: props } : { eventType: "focusTime", focusTimeProperties: { ...props, chatStatus: "available" } }),
  };
}

// The same time as a plain busy block (personal Gmail), with the message as its description.
export function busyEvent(i: AwayInput) {
  return { summary: AWAY_TITLE[i.kind], transparency: "opaque", description: i.message || undefined, ...when(i), ...tag(i.kind) };
}

// Google's answer when the account can't have status events (personal Gmail, or the feature is switched off).
export const isNotSupported = (status: number, body: string) => status === 400 && /malformed(OutOfOffice|FocusTime)Event/.test(body);
