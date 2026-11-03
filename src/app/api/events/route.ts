import { auth } from "@/auth";
import { listEvents } from "@/lib/calendar";
import { ReauthError } from "@/lib/google";

const DAY_MS = 24 * 60 * 60 * 1000;

// GET /api/events?from=ISO&to=ISO&cal=<id>&cal=<id>[&q=search] → events from those calendars in that range.
// Calendar ids come from the browser, but Google only returns calendars this user can access.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "signin" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const ids = params.getAll("cal");
  const query = params.get("q")?.trim() || undefined;
  const from = new Date(params.get("from") ?? "");
  const to = new Date(params.get("to") ?? "");
  const maxRange = (query ? 2 * 366 : 62) * DAY_MS;
  if (
    isNaN(+from) || isNaN(+to) || to <= from || +to - +from > maxRange ||
    ids.length === 0 || ids.length > 50 || ids.some((id) => id.length > 300) ||
    (query && query.length > 100)
  ) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    return Response.json(await listEvents(session.user.id, ids, from.toISOString(), to.toISOString(), query));
  } catch (err) {
    if (err instanceof ReauthError) return Response.json({ error: "reauth" }, { status: 401 });
    throw err;
  }
}
