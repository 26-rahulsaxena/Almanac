import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { checkinText } from "@/lib/priorities";

export type Alert = { kind: "reminder" | "checkin"; id: string; title: string; body: string; ask?: "start" | "finished"; sentAt: string };

// GET /api/alerts → what's waiting for an answer, for the alerts inside the open app: reminders that went off in the
// last 15 minutes (including ones coming back from Snooze), and check-ins ("Finished X?", "Time to start X") not yet
// answered. Answers go to /api/reminders/ack and /api/priorities/answer.
export async function GET() {
  const id = (await auth())?.user?.id;
  if (!id) return Response.json({ error: "signin" }, { status: 401 });
  const [reminders, checkins] = await Promise.all([
    sql<{ id: string; title: string; body: string; sent_at: Date }[]>`
      select id, title, body, sent_at from reminder_deliveries
      where user_id = ${id} and status = 'sent' and sent_at > now() - interval '15 minutes'`,
    sql<{ id: string; title: string; status: string; due_at: Date; checkin_sent_at: Date; timezone: string }[]>`
      select d.id, d.title, d.status, d.due_at, d.checkin_sent_at, u.timezone from deadline_states d join users u on u.id = d.user_id
      where d.user_id = ${id} and d.checkin_sent_at > now() - interval '15 minutes' and d.status in ('doing', 'later', 'stuck')`,
  ]);
  const alerts: Alert[] = [
    ...reminders.map((r) => ({ kind: "reminder" as const, id: r.id, title: r.title, body: r.body, sentAt: r.sent_at.toISOString() })),
    ...checkins.map((c) => ({ kind: "checkin" as const, id: c.id, ...checkinText(c.title, c.status, c.due_at, c.timezone), sentAt: c.checkin_sent_at.toISOString() })),
  ];
  return Response.json(alerts.sort((a, b) => a.sentAt.localeCompare(b.sentAt)));
}
