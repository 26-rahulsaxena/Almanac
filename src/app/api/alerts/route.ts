import { auth } from "@/auth";
import { sql } from "@/lib/db";

// GET /api/alerts → reminders that went off in the last 15 minutes and haven't been answered (Done / Snooze),
// for the full-screen alert inside the open app. Answering uses /api/reminders/ack.
export async function GET() {
  const id = (await auth())?.user?.id;
  if (!id) return Response.json({ error: "signin" }, { status: 401 });
  const rows = await sql<{ id: string; title: string; body: string }[]>`
    select id, title, body from reminder_deliveries
    where user_id = ${id} and status = 'sent' and sent_at > now() - interval '15 minutes'
    order by sent_at`;
  return Response.json(rows);
}
