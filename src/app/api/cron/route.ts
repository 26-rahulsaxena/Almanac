import { sql } from "@/lib/db";
import { listCalendars, listEvents, type Ev } from "@/lib/calendar";
import { sendPush } from "@/lib/push";
import { dueReminders, LOOKAHEAD_MS } from "@/lib/reminders";

// GET /api/cron — called every minute by the scheduler (Supabase pg_cron in production) with the shared secret.
// Sends due reminders, re-sends snoozed ones, and deletes old reminder records.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });

  const now = new Date();
  // shortcut: checks every user with a notification device, one after another, each minute; fine for a handful of users, batch or queue it for hundreds.
  const users = await sql<{ id: string; timezone: string; hidden_calendars: string[] }[]>`
    select u.id, u.timezone, u.hidden_calendars from users u
    where exists (select 1 from push_subscriptions p where p.user_id = u.id)`;

  let sent = 0;
  for (const u of users) {
    try {
      sent += await remindUser(u.id, u.timezone, u.hidden_calendars, now);
    } catch (err) {
      console.error(`Reminders for user ${u.id} failed:`, err); // e.g. Google login expired; others still get theirs
    }
  }

  const snoozed = await sql<{ id: string; user_id: string; title: string; body: string }[]>`
    update reminder_deliveries set status = 'sent', snooze_until = null, sent_at = now()
    where status = 'snoozed' and snooze_until <= now()
    returning id, user_id, title, body`;
  for (const d of snoozed) await sendPush(d.user_id, { id: d.id, title: d.title, body: d.body });

  await sql`delete from reminder_deliveries where fire_at < now() - interval '2 days'`;
  return Response.json({ users: users.length, sent, snoozed: snoozed.length });
}

async function remindUser(userId: string, timeZone: string, hidden: string[], now: Date) {
  const calendars = (await listCalendars(userId)).filter((c) => !hidden.includes(c.id));
  const defaults = new Map(calendars.map((c) => [c.id, c.defaultReminders]));
  const events = await listEvents(userId, calendars.map((c) => c.id), now.toISOString(), new Date(+now + LOOKAHEAD_MS).toISOString());

  let sent = 0;
  for (const e of events) {
    for (const due of dueReminders(e, defaults.get(e.calendarId) ?? [], now, timeZone)) {
      const body = describe(e, now, timeZone);
      // The unique key makes each reminder fire once, even if two minute-jobs overlap.
      const [row] = await sql<{ id: string }[]>`
        insert into reminder_deliveries (user_id, calendar_id, event_id, minutes, fire_at, title, body)
        values (${userId}, ${e.calendarId}, ${e.id}, ${due.minutes}, ${due.fireAt}, ${e.title}, ${body})
        on conflict do nothing
        returning id`;
      if (row) {
        await sendPush(userId, { id: row.id, title: e.title, body });
        sent++;
      }
    }
  }
  return sent;
}

// "In 10 min · 10:00 am – 11:00 am · Room 4" in the user's own time zone.
function describe(e: Ev, now: Date, timeZone: string) {
  const time = (s: string) => new Date(s).toLocaleTimeString("en-IN", { timeZone, hour: "numeric", minute: "2-digit" });
  const mins = Math.round((+new Date(e.start) - +now) / 60_000);
  const when = e.allDay
    ? "All day"
    : mins <= 0
      ? `Now · ${time(e.start)} – ${time(e.end)}`
      : `In ${mins < 60 ? `${mins} min` : `${Math.round(mins / 60)} h`} · ${time(e.start)} – ${time(e.end)}`;
  return [when, e.location, e.meetLink && "Google Meet"].filter(Boolean).join(" · ");
}
