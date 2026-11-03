import { auth } from "@/auth";
import { getMaster, listEvents } from "@/lib/calendar";
import { gcal, ReauthError } from "@/lib/google";
import { planDelete, planSave } from "@/lib/recurrence";
import { InvalidInput, parseDelete, parseSave } from "@/lib/validate";

const DAY_MS = 24 * 60 * 60 * 1000;

// GET /api/events?from=ISO&to=ISO&cal=<id>&cal=<id>[&q=search] → events from those calendars in that range.
// GET /api/events?master=<id>&cal=<id> → a repeating event's series rules.
// Calendar ids come from the browser, but Google only returns calendars this user can access.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "signin" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const ids = params.getAll("cal");
  if (ids.length === 0 || ids.length > 50 || ids.some((id) => id.length > 300)) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  return withGoogle(async () => {
    const master = params.get("master");
    if (master) {
      if (master.length > 1024) return Response.json({ error: "Invalid request" }, { status: 400 });
      return Response.json(await getMaster(session.user!.id!, ids[0], master));
    }

    const query = params.get("q")?.trim() || undefined;
    const from = new Date(params.get("from") ?? "");
    const to = new Date(params.get("to") ?? "");
    const maxRange = (query ? 2 * 366 : 62) * DAY_MS;
    if (isNaN(+from) || isNaN(+to) || to <= from || +to - +from > maxRange || (query && query.length > 100)) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }
    return Response.json(await listEvents(session.user!.id!, ids, from.toISOString(), to.toISOString(), query));
  });
}

// POST /api/events → create or edit (JSON body, see SaveInput). DELETE /api/events → delete (see DeleteInput).
// The browser asks for confirmation (and which occurrences) before calling these.
export const POST = (req: Request) => write(req, "save");
export const DELETE = (req: Request) => write(req, "delete");

async function write(req: Request, kind: "save" | "delete") {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "signin" }, { status: 401 });

  let parsed;
  try {
    const body = await req.json();
    parsed = kind === "save" ? ({ kind, input: parseSave(body) } as const) : ({ kind, input: parseDelete(body) } as const);
  } catch (err) {
    return Response.json({ error: err instanceof InvalidInput ? err.message : "Invalid request" }, { status: 400 });
  }

  return withGoogle(async () => {
    const { input } = parsed;
    const master = input.recurringEventId && input.scope !== "this" ? await getMaster(userId, input.calendarId, input.recurringEventId) : undefined;
    const ops = parsed.kind === "save" ? planSave(parsed.input, master) : planDelete(parsed.input, master);
    // Run one at a time, in order: for "this and following" the new series is created before the old one is shortened.
    for (const op of ops) {
      await gcal(userId, op.path, {
        method: op.method,
        headers: { "Content-Type": "application/json" },
        body: op.body && JSON.stringify(op.body),
      });
    }
    return Response.json({ ok: true });
  });
}

async function withGoogle(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ReauthError) return Response.json({ error: "reauth" }, { status: 401 });
    console.error(err);
    return Response.json({ error: "Google didn't accept that. Check the event in Google Calendar and try again." }, { status: 502 });
  }
}
