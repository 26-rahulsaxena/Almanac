import { sql } from "@/lib/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// POST /api/priorities/answer {id, action} — buttons on a check-in notification.
//   done: "Yes, done"   more: "Need 30 more min"   doing: "Doing it now" (checks back in an hour)   open: just opened the app
// Like reminders, the check-in's random id is the permission, so this works from the lock screen.
export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  if (typeof b?.id !== "string" || !UUID.test(b.id) || !["done", "more", "doing", "open"].includes(b.action)) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  if (b.action === "done") await sql`update deadline_states set status = 'done', next_check_at = null where id = ${b.id}`;
  if (b.action === "more") await sql`update deadline_states set status = 'doing', next_check_at = now() + interval '30 minutes' where id = ${b.id}`;
  if (b.action === "doing") await sql`update deadline_states set status = 'doing', next_check_at = now() + interval '1 hour' where id = ${b.id}`;
  return Response.json({ ok: true });
}
