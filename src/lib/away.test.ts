import { describe, expect, it } from "vitest";
import { busyEvent, isNotSupported, parseAway, statusEvent } from "./away";

const now = new Date("2026-11-08T05:00:00Z");
const ok = { kind: "ooo", start: "2026-11-09T00:00:00+05:30", end: "2026-11-11T00:00:00+05:30", decline: "new", message: " Back on Wednesday. " };

describe("away", () => {
  it("checks what the browser sent", () => {
    const i = parseAway(ok, now);
    expect(i).toMatchObject({ kind: "ooo", decline: "new", message: "Back on Wednesday." });
    expect(() => parseAway({ ...ok, kind: "party" }, now)).toThrow();
    expect(() => parseAway({ ...ok, end: ok.start }, now)).toThrow("after the start");
    expect(() => parseAway({ ...ok, start: "2026-11-01T00:00:00Z", end: "2026-11-02T00:00:00Z" }, now)).toThrow("already passed");
    expect(() => parseAway({ ...ok, kind: "focus" }, now)).toThrow("12 hours");
    expect(() => parseAway({ ...ok, message: "x".repeat(301) }, now)).toThrow("300");
  });

  it("builds Google's out-of-office, or a busy block when the account can't", () => {
    const i = parseAway(ok, now);
    expect(statusEvent(i)).toMatchObject({
      eventType: "outOfOffice",
      transparency: "opaque",
      start: { dateTime: "2026-11-08T18:30:00.000Z" },
      outOfOfficeProperties: { autoDeclineMode: "declineOnlyNewConflictingInvitations", declineMessage: "Back on Wednesday." },
    });
    expect(statusEvent({ ...i, decline: "none" })).toMatchObject({ outOfOfficeProperties: { autoDeclineMode: "declineNone" } });
    expect(statusEvent({ ...i, decline: "none" })).not.toHaveProperty("outOfOfficeProperties.declineMessage");
    expect(statusEvent({ ...i, kind: "focus" })).toMatchObject({ eventType: "focusTime", summary: "Focus time" });
    expect(busyEvent(i)).toEqual({
      summary: "Out of office",
      transparency: "opaque",
      description: "Back on Wednesday.",
      start: { dateTime: "2026-11-08T18:30:00.000Z" },
      end: { dateTime: "2026-11-10T18:30:00.000Z" },
      extendedProperties: { private: { almanacAway: "ooo" } },
    });
    expect(isNotSupported(400, '{"reason":"malformedOutOfOfficeEvent"}')).toBe(true);
    expect(isNotSupported(400, '{"reason":"invalid"}')).toBe(false);
  });
});
