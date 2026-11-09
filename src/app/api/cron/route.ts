import { healthCheck, sql } from "@/lib/db";
import { listCalendars, listEvents, type Ev } from "@/lib/calendar";
import { morningCheck, replan } from "@/lib/planner";
import { dayPlanText } from "@/lib/coach";
import { coachToday, coachWeek } from "@/lib/coach-data";
import { checkinText } from "@/lib/priorities";
import latest from "@/lib/android-build.json";
import { appOrigin, FCM_PREFIX, sendPush } from "@/lib/push";
import { dueReminders, LOOKAHEAD_MS } from "@/lib/reminders";

const DIGEST_HOUR = 8;
const ROLLOVER_HOUR = 21; // from 9 pm, to-dos whose time has passed unfinished move on
const REVIEW_HOUR = 18; // Sunday from 6 pm: the week-in-review notification

// GET /api/cron — called every minute by the scheduler (Supabase pg_cron in production) with the shared secret.
// Sends due reminders and deadline check-ins, re-sends snoozed reminders, sends the 8 am priorities summary,
// runs the auto-planner, and deletes old records.
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

  const planned = await autoPlanUsers();
  const updates = await announceAppUpdate();

  await sql`delete from reminder_deliveries where fire_at < now() - interval '2 days'`;
  await sql`delete from deadline_states where due_at < now() - interval '7 days'`;
  return Response.json({ users: users.length, sent, snoozed: snoozed.length, checkins, digests, planned, updates });
}

// A new Android app build is live (the build writes src/lib/android-build.json, and the site redeploys with it):
// tell every phone with the app, once per build. Returns how many phones were reached.
async function announceAppUpdate() {
  const [fresh] = await sql`
    insert into app_meta (key, value) values ('announced_build', ${String(latest.build)})
    on conflict (key) do update set value = excluded.value where app_meta.value::int < ${latest.build}
    returning value`;
  if (!fresh) return 0;
  const owners = await sql<{ user_id: string }[]>`
    select distinct user_id from push_subscriptions where endpoint like ${FCM_PREFIX + "%"} and origin = ${appOrigin()}`;
  let reached = 0;
  for (const o of owners) {
    reached += await sendPush(
      o.user_id,
      { kind: "update", title: "New version of Almanac", body: "Install it from Settings → App. It updates in place and you stay signed in." },
      (endpoint) => endpoint.startsWith(FCM_PREFIX),
    ).catch(() => 0);
  }
  return reached;
}

// Auto-planner, every 15 minutes per user: Almanac's blocks out of the way of new events, and from 9 pm (your time)
// to-dos whose block has ended unfinished on to tomorrow or later. In Ask-first mode these are suggestions (with a
// notification when there's something new to approve); in Automatic mode they're done, and you're told after.
async function autoPlanUsers() {
  const due = await sql<{ id: string; timezone: string; hidden_calendars: string[]; rollover: boolean }[]>`
    update users u set planned_at = now()
    where (u.planned_at is null or u.planned_at < now() - interval '15 minutes')
      and (exists (select 1 from routines r where r.user_id = u.id)
           or exists (select 1 from todos t where t.user_id = u.id and not t.done and (t.auto or t.event_id is not null)))
    returning u.id, u.timezone, u.hidden_calendars, extract(hour from now() at time zone u.timezone) >= ${ROLLOVER_HOUR} as rollover`;
  let changed = 0;
  for (const u of due) {
    try {
      const r = await replan(u, { rollover: u.rollover });
      if (!r) continue;
      if (r.suggested.length) {
        changed++;
        await sendPush(u.id, { kind: "digest", title: `Almanac suggests ${r.suggested.length} change${r.suggested.length === 1 ? "" : "s"}. Approve?`, body: r.suggested.join(" · ") });
      } else if (r.moved.length) {
        changed++;
        await sendPush(u.id, { kind: "digest", title: "Almanac moved things in your plan", body: r.moved.join(" · ") });
      }
    } catch (err) {
      console.error(`Auto-plan for user ${u.id} failed:`, err);
    }
  }
  return changed;
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

// Once a day after 8 am (user's time), today's plan: "Today: 4 events, first 9:00 am · 3 h free" ·
// "2:40 pm → Finance assignment". On Sunday evenings, also a pointer to the week in review.
async function morningDigest(userId: string, timeZone: string, hidden: string[], now: Date) {
  const u = { id: userId, timezone: timeZone, hidden_calendars: hidden };
  let sent = 0;
  const [claim] = await sql<{ id: string }[]>`
    update users set last_digest_on = (now() at time zone ${timeZone})::date
    where id = ${userId}
      and extract(hour from now() at time zone ${timeZone}) >= ${DIGEST_HOUR}
      and (last_digest_on is null or last_digest_on < (now() at time zone ${timeZone})::date)
    returning id`;
  if (claim) {
    const { today } = await coachToday(u, now);
    if (today.count || today.blocks.length) {
      await sendPush(userId, { kind: "digest", ...dayPlanText(today, timeZone) });
      sent++;
    }
    const fixes = await morningCheck(u, now);
    if (fixes.length) {
      await sendPush(userId, { kind: "digest", title: `${fixes.length} clash${fixes.length === 1 ? "" : "es"} today. Approve the fix?`, body: fixes.join(" · ") });
      sent++;
    }
  }
  const [review] = await sql<{ id: string }[]>`
    update users set last_review_on = (now() at time zone ${timeZone})::date
    where id = ${userId}
      and extract(dow from now() at time zone ${timeZone}) = 0
      and extract(hour from now() at time zone ${timeZone}) >= ${REVIEW_HOUR}
      and (last_review_on is null or last_review_on < (now() at time zone ${timeZone})::date)
    returning id`;
  if (review) {
    const r = await coachWeek(u, now);
    const top = r.byCategory[0];
    await sendPush(userId, {
      kind: "review",
      title: "Your week in review",
      body: [
        top && `Most time on ${top.label.toLowerCase()} (${Math.round(top.minutes / 60)} h)`,
        r.deadlines.total && `${r.deadlines.met} of ${r.deadlines.total} deadlines marked done`,
        r.overdue.length && `${r.overdue.length} to-do${r.overdue.length === 1 ? "" : "s"} overdue`,
      ]
        .filter(Boolean)
        .join(" · ") || "Open Almanac to see where your time went.",
    });
    sent++;
  }
  return sent;
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
    if (e.away === "ooo") continue; // no reminders or start alarm for being out of office
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
        await sendPush(userId, { id: row.id, title: e.title, body, snooze: u.snooze_minutes, alarm: due.alarm });
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
