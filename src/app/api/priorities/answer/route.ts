import { sql } from "@/lib/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// POST /api/priorities/answer {id, action} — buttons on a check-in notification or the in-app alert.
//   done: "Yes, done"   more: "Need 30 more min"   doing: "Doing it now" (checks back in an hour)
//   snooze: "Ask me again in 5 min"   open: just opened the app (leaves the check-in waiting for an answer)
// Like reminders, the check-in's random id is the permission, so this works from the lock screen.
export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  if (typeof b?.id !== "string" || !UUID.test(b.id) || !["done", "more", "doing", "snooze", "open"].includes(b.action)) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  if (b.action === "done") {
    const [s] = await sql<{ user_id: string; calendar_id: string; event_id: string }[]>`
      update deadline_states set status = 'done', next_check_at = null, checkin_sent_at = null where id = ${b.id}
      returning user_id, calendar_id, event_id`;
    if (s) await sql`update todos set done = true where user_id = ${s.user_id} and calendar_id = ${s.calendar_id} and event_id = ${s.event_id}`;
  }
  if (b.action === "more")
    await sql`update deadline_states set status = 'doing', next_check_at = now() + interval '30 minutes', checkin_sent_at = null where id = ${b.id}`;
  if (b.action === "doing")
    await sql`update deadline_states set status = 'doing', next_check_at = now() + interval '1 hour', checkin_sent_at = null where id = ${b.id}`;
  if (b.action === "snooze") await sql`update deadline_states set next_check_at = now() + interval '5 minutes', checkin_sent_at = null where id = ${b.id}`;
  return Response.json({ ok: true });
}
