import { sql } from "@/lib/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// POST /api/reminders/ack {id, action: "done" | "snooze" | "open"} — from a notification's buttons.
// The reminder's random id is the permission: it was only ever sent to this user's own devices,
// so the buttons work even when the phone's login cookie has expired.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const id = body?.id;
  const action = body?.action;
  if (typeof id !== "string" || !UUID.test(id) || !["done", "snooze", "open"].includes(action)) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  if (action === "snooze") {
    await sql`
      update reminder_deliveries r set status = 'snoozed', snooze_until = now() + make_interval(mins => u.snooze_minutes), acked_at = now()
      from users u
      where r.id = ${id} and u.id = r.user_id`;
  } else {
    await sql`update reminder_deliveries set status = 'done', snooze_until = null, acked_at = now() where id = ${id}`;
  }
  return Response.json({ ok: true });
}
