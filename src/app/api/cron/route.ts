import { healthCheck, sql } from "@/lib/db";
import { listCalendars, listEvents, type Ev } from "@/lib/calendar";
import { checkinText, loadPriorities } from "@/lib/priorities";
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

  await healthCheck();
  const now = new Date();
  // Every signed-in user, with or without a notification device: due reminders are also shown full screen
  // inside the open app, which reads them from reminder_deliveries.
  // shortcut: checks every user one after another, each minute; fine for a handful of users, batch or queue it for hundreds.
  const users = await sql<{ id: string; timezone: string; hidden_calendars: string[]; remind_popup: boolean; snooze_minutes: number; alarm_at_start: boolean }[]>`
    select u.id, u.timezone, u.hidden_calendars, u.remind_popup, u.snooze_minutes, u.alarm_at_start from users u
    where exists (select 1 from google_tokens t where t.user_id = u.id)`;

  let sent = 0;
  for (const u of users) {
    try {
      sent += await remindUser(u, now);
    } catch (err) {
      console.error(`Reminders for user ${u.id} failed:`, err); // e.g. Google login expired; others still get theirs
    }
  }

  // Stage 2: a reminder left unanswered comes back once after the snooze time, as if Snooze was pressed. Not once
  // the event has started: the start alarm takes over then.
  await sql`
    update reminder_deliveries r set status = 'snoozed', snooze_until = now(), repeated = true
    from users u
    where u.id = r.user_id and r.status = 'sent' and not r.alarm and not r.repeated
      -- 30 s slack: runs are a minute apart and land on the same second the reminder was sent, so it would miss by a hair
      and r.sent_at <= now() - make_interval(mins => u.snooze_minutes) + interval '30 seconds'
      and r.fire_at + make_interval(mins => r.minutes) > now()`;
  const snoozed = await sql<{ id: string; user_id: string; title: string; body: string; snooze_minutes: number }[]>`
    update reminder_deliveries r set status = 'sent', snooze_until = null, sent_at = now(),
      body = 'Again · ' || regexp_replace(r.body, '^(In [^·]+|Now|Snoozed|Again) · ', '') -- "In 9 min" would be stale by now
    from users u
    where u.id = r.user_id and r.status = 'snoozed' and r.snooze_until <= now()
    returning r.id, r.user_id, r.title, r.body, u.snooze_minutes`;
  for (const d of snoozed) await sendPush(d.user_id, { id: d.id, title: d.title, body: d.body, snooze: d.snooze_minutes });

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
    update deadline_states d set next_check_at = now() + interval '30 minutes', checkin_sent_at = now()
    from users u
    where u.id = d.user_id and d.next_check_at <= now() and d.status in ('doing', 'later', 'stuck') and d.due_at > now()
    returning d.id, d.user_id, d.title, d.due_at, d.status, u.timezone`;
  for (const d of due) await sendPush(d.user_id, { kind: "checkin", id: d.id, ...checkinText(d.title, d.status, d.due_at, d.timezone) });
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

type Settings = { id: string; timezone: string; hidden_calendars: string[]; remind_popup: boolean; snooze_minutes: number; alarm_at_start: boolean };

async function remindUser(u: Settings, now: Date) {
  const userId = u.id;
  const timeZone = u.timezone;
  const calendars = (await listCalendars(userId)).filter((c) => !u.hidden_calendars.includes(c.id));
  const defaults = new Map(calendars.map((c) => [c.id, c.defaultReminders]));
  const events = await listEvents(userId, calendars.map((c) => c.id), now.toISOString(), new Date(+now + LOOKAHEAD_MS).toISOString());
  const stages = { remind: u.remind_popup, alarm: u.alarm_at_start };

  let sent = 0;
  for (const e of events) {
    if (e.attendees?.find((a) => a.self)?.responseStatus === "declined") continue;
    for (const due of dueReminders(e, defaults.get(e.calendarId) ?? [], now, timeZone, stages)) {
      const body = describe(e, now, timeZone);
      // The unique key makes each reminder fire once, even if two minute-jobs overlap.
      const [row] = await sql<{ id: string }[]>`
        insert into reminder_deliveries (user_id, calendar_id, event_id, minutes, fire_at, title, body, alarm)
        values (${userId}, ${e.calendarId}, ${e.id}, ${due.minutes}, ${due.fireAt}, ${e.title}, ${body}, ${due.alarm})
        on conflict do nothing
        returning id`;
      if (row) {
        // The start alarm stands alone: earlier pop-ups for this event, still showing or snoozed, are closed.
        if (due.alarm) await sql`
          update reminder_deliveries set status = 'done', snooze_until = null
          where user_id = ${userId} and calendar_id = ${e.calendarId} and event_id = ${e.id} and not alarm and status <> 'done'`;
        await sendPush(userId, { id: row.id, title: e.title, body, snooze: u.snooze_minutes });
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
