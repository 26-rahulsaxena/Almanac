import { auth } from "@/auth";
import { ReauthError } from "@/lib/google";
import { approveSuggestion, dismissSuggestion, listSuggestions, me, replan } from "@/lib/planner";
import { InvalidInput } from "@/lib/validate";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = (error: string, status = 400) => Response.json({ error }, { status });

// GET /api/suggestions → the auto-planner's suggestions waiting for your OK (Ask-first mode).
export async function GET() {
  const u = await me((await auth())?.user?.id);
  if (!u) return fail("signin", 401);
  return Response.json(await listSuggestions(u.id));
}

// POST /api/suggestions {id, action: "approve" | "dismiss"} or {all: true, action: "approve"} → answers with the
// fresh list. Approving carries the change out in Google, then the plan is refreshed around it.
export async function POST(req: Request) {
  const u = await me((await auth())?.user?.id);
  if (!u) return fail("signin", 401);
  const b = await req.json().catch(() => null);
  const ids: string[] = b?.all === true ? (await listSuggestions(u.id)).map((s) => s.id) : [b?.id];
  if (!["approve", "dismiss"].includes(b?.action) || !ids.every((id) => UUID.test(id ?? "")) || (b.all && b.action !== "approve")) return fail("Invalid request");
  try {
    for (const id of ids) {
      // With "Approve all", one that went out of date meanwhile is skipped rather than stopping the rest.
      const run = b.action === "approve" ? approveSuggestion(u, id) : dismissSuggestion(u, id);
      await (b.all ? run.catch((e) => (e instanceof InvalidInput ? undefined : Promise.reject(e))) : run);
    }
    if (b.action === "approve") await replan(u);
    return Response.json(await listSuggestions(u.id));
  } catch (err) {
    if (err instanceof InvalidInput) return Response.json({ error: err.message, list: await listSuggestions(u.id) }, { status: 409 });
    if (err instanceof ReauthError) return fail("reauth", 401);
    console.error(err);
    return fail("Couldn't make that change. Try again.", 502);
  }
}
