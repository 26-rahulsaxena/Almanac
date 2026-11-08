import { auth } from "@/auth";
import { busyEvent, isNotSupported, parseAway, statusEvent } from "@/lib/away";
import { gcal, GoogleError, ReauthError } from "@/lib/google";
import { InvalidInput } from "@/lib/validate";

// POST /api/away {kind: "ooo" | "focus", start, end, decline: "none" | "new" | "all", message} → adds it to your main
// calendar (Google only allows these there). The pop-up shows what will be declined before you press Save.
// → {ok, busyBlock}: busyBlock = your account couldn't do Google's own kind, so it's a plain busy block instead.
export async function POST(req: Request) {
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: "signin" }, { status: 401 });

  let input;
  try {
    input = parseAway(await req.json().catch(() => null));
  } catch (err) {
    return Response.json({ error: err instanceof InvalidInput ? err.message : "Invalid request" }, { status: 400 });
  }

  const add = (body: object) =>
    gcal(userId, "/calendars/primary/events?sendUpdates=none", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    try {
      await add(statusEvent(input));
      return Response.json({ ok: true, busyBlock: false });
    } catch (err) {
      if (!(err instanceof GoogleError && isNotSupported(err.status, err.body))) throw err;
      await add(busyEvent(input));
      return Response.json({ ok: true, busyBlock: true });
    }
  } catch (err) {
    if (err instanceof ReauthError) return Response.json({ error: "reauth" }, { status: 401 });
    console.error(err);
    return Response.json({ error: "Google didn't accept that. Try again." }, { status: 502 });
  }
}
