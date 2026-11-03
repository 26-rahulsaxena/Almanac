import { auth } from "@/auth";
import { listCalendars, listEvents } from "@/lib/calendar";
import { ReauthError } from "@/lib/google";

const MAX_RANGE_MS = 62 * 24 * 60 * 60 * 1000;

// GET /api/events?from=ISO&to=ISO → events from every calendar in that range.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "signin" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const from = new Date(params.get("from") ?? "");
  const to = new Date(params.get("to") ?? "");
  if (isNaN(+from) || isNaN(+to) || to <= from || +to - +from > MAX_RANGE_MS) {
    return Response.json({ error: "Invalid date range" }, { status: 400 });
  }

  try {
    const calendars = await listCalendars(session.user.id);
    return Response.json(await listEvents(session.user.id, calendars, from.toISOString(), to.toISOString()));
  } catch (err) {
    if (err instanceof ReauthError) return Response.json({ error: "reauth" }, { status: 401 });
    throw err;
  }
}
