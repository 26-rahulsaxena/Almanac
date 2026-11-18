import { auth } from "@/auth";
import { ReauthError } from "@/lib/google";
import { me } from "@/lib/planner";
import { todayCounts } from "@/lib/today";

// GET /api/today → {events, minutes, unread, todos, overdue}: the numbers at the top of Today.
export async function GET() {
  const u = await me((await auth())?.user?.id);
  if (!u) return Response.json({ error: "signin" }, { status: 401 });
  try {
    return Response.json(await todayCounts(u));
  } catch (err) {
    if (err instanceof ReauthError) return Response.json({ error: "reauth" }, { status: 401 });
    console.error(err);
    return Response.json({ error: "Couldn't count today. Try again." }, { status: 502 });
  }
}
