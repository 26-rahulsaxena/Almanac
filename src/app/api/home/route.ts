import { auth } from "@/auth";
import { ReauthError } from "@/lib/google";
import { homeActions } from "@/lib/home";
import { me } from "@/lib/planner";

// GET /api/home → {today, overdue, week, month}: Home's action list (see lib/home.ts).
export async function GET() {
  const u = await me((await auth())?.user?.id);
  if (!u) return Response.json({ error: "signin" }, { status: 401 });
  try {
    return Response.json(await homeActions(u));
  } catch (err) {
    if (err instanceof ReauthError) return Response.json({ error: "reauth" }, { status: 401 });
    console.error(err);
    return Response.json({ error: "Couldn't put your list together. Try again." }, { status: 502 });
  }
}
