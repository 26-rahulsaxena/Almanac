import { sql } from "@/lib/db";
import { listCalendars, listEvents, type Ev } from "@/lib/calendar";
import { loadPriorities } from "@/lib/priorities";
import { sendPush } from "@/lib/push";
import { syncSheet } from "@/lib/sheet-sync";
import { dueReminders, LOOKAHEAD_MS } from "@/lib/reminders";

const DIGEST_HOUR = 8;

// GET /api/cron — called every minute by the scheduler (Supabase pg_cron in production) with the shared secret.
// Sends due reminders and deadline check-ins, re-sends snoozed reminders, sends the 8 am priorities summary,
// syncs Google Sheets, and deletes old records.
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

  const checkins = await sendCheckins();
  let digests = 0;
  for (const u of users) {
    try {
      digests += await morningDigest(u.id, u.timezone, u.hidden_calendars, now);
    } catch (err) {
      console.error(`Morning summary for user ${u.id} failed:`, err);
    }
  }

  // Google Sheet: checked every minute, synced only when it was edited since last time. Claiming the slot first
  // keeps two overlapping runs from syncing twice.
  const sheets = await sql<{ id: string; timezone: string; hidden_calendars: string[]; sheet_id: string }[]>`
    update users set sheet_synced_at = now()
    where sheet_id is not null and (sheet_synced_at is null or sheet_synced_at < now() - interval '50 seconds')
    returning id, timezone, hidden_calendars, sheet_id`;
  for (const s of sheets) {
    try {
      await syncSheet(s, s.sheet_id, true);
    } catch (err) {
      console.error(`Sheet sync for user ${s.id} failed:`, err);
    }
  }

  await sql`delete from reminder_deliveries where fire_at < now() - interval '2 days'`;
  await sql`delete from deadline_states where due_at < now() - interval '7 days'`;
  return Response.json({ users: users.length, sent, snoozed: snoozed.length, checkins, digests, sheets: sheets.length });
}

// Check-ins you asked for ("Later", "Doing it now", "Stuck"). Unanswered ones repeat every 30 minutes until
// you answer or the deadline passes.
async function sendCheckins() {
  const due = await sql<{ id: string; user_id: string; title: string; due_at: Date; status: string; timezone: string }[]>`
    update deadline_states d set next_check_at = now() + interval '30 minutes'
    from users u
    where u.id = d.user_id and d.next_check_at <= now() and d.status in ('doing', 'later', 'stuck') and d.due_at > now()
    returning d.id, d.user_id, d.title, d.due_at, d.status, u.timezone`;
  for (const d of due) {
    const when = d.due_at.toLocaleString("en-IN", { timeZone: d.timezone, weekday: "short", hour: "numeric", minute: "2-digit" });
    await sendPush(d.user_id, {
      kind: "checkin",
      id: d.id,
      ask: d.status === "later" ? "start" : "finished",
      title: d.status === "later" ? `Time to start “${d.title}”` : `Finished “${d.title}”?`,
      body: `${when}${d.status === "stuck" ? " · still stuck? Open Almanac to replan" : ""}`,
    });
  }
  return due.length;
}

// Once a day after 8 am (user's time): "3 deadlines in the next 5 days · 1 critical".
async function morningDigest(userId: string, timeZone: string, hidden: string[], now: Date) {
  const [claim] = await sql<{ id: string }[]>`
    update users set last_digest_on = (now() at time zone ${timeZone})::date
    where id = ${userId}
      and extract(hour from now() at time zone ${timeZone}) >= ${DIGEST_HOUR}
      and (last_digest_on is null or last_digest_on < (now() at time zone ${timeZone})::date)
    returning id`;
  if (!claim) return 0;
  const open = (await loadPriorities(userId, timeZone, hidden, now)).filter((p) => p.status !== "done");
  if (!open.length) return 0;
  const critical = open.filter((p) => p.severity === "critical").length;
  const top = open[0];
  await sendPush(userId, {
    kind: "digest",
    title: `${open.length} thing${open.length === 1 ? "" : "s"} on your plate in the next 5 days${critical ? ` · ${critical} critical` : ""}`,
    body: `First: ${top.title} (${top.reason.toLowerCase()})`,
  });
  return 1;
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
