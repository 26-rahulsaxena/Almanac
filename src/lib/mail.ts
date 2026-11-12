// "Read my email": every minute, new mail in the Primary inbox is read by the AI for meetings, calls and
// deadlines. In Ask-first mode these wait in "Found in your email" for Add / Not now; in Automatic mode they go
// straight onto the calendar (meetings and calls as events, deadlines as to-dos). Never invites anyone.
// The email text is only passed to the AI; nothing of it is kept except a short quote of what was found.

import { GMAIL_SCOPE } from "@/auth";
import { askJson, hasAi } from "./ai";
import { listCalendars, type Cal } from "./calendar";
import { sql } from "./db";
import { google } from "./google";
import { gmailLink, header, parseFinds, prompt, senderName, skip, SYSTEM, textOf, whenOf, type Find, type Kind, type Mail, type Part } from "./mail-parse";
import { midnightIn } from "./reminders";
import { bookBlock, upcoming, type User } from "./planner";
import { sendPush } from "./push";
import { freeSlots } from "./time";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const FIRST_LOOK_DAYS = 7; // when switched on, how far back it reads
const BATCH = 8; // emails per AI question
const LOOK_BACK_MS = 3_600_000;

type MailUser = User & { email: string; plan_mode: "ask" | "auto"; since: Date | null };
// thread_id: the email's conversation (finds from before it was kept use the email itself, the same for a first message).
export type MailFind = { id: string; message_id: string; thread_id: string; kind: Kind; title: string; start_at: Date; end_at: Date | null; summary: string; quote: string; sender: string };
export const FIELDS = "id, message_id, coalesce(thread_id, message_id) as thread_id, kind, title, start_at, end_at, summary, quote, sender";

// Users whose mail is due a read (switched on, Gmail allowed, not already read this minute), each claimed so two
// minute-jobs never read the same mail twice. since: when it was last checked (null: never, so look back a week).
export async function scanAll(now = new Date()) {
  if (!hasAi()) return 0;
  const due = await sql<MailUser[]>`
    with due as (
      select u.id, u.mail_checked_at as since from users u
      -- every minute-job (50 s, as runs land a hair under a minute apart); the AI only runs when there's new mail
      where u.mail_on and (u.mail_checked_at is null or u.mail_checked_at < now() - interval '50 seconds')
        and exists (select 1 from google_tokens t where t.user_id = u.id and t.scope like ${"%" + GMAIL_SCOPE + "%"})
      for update skip locked
    )
    update users u set mail_checked_at = now() from due where u.id = due.id
    returning u.id, u.timezone, u.hidden_calendars, u.email, u.plan_mode, due.since`;
  let found = 0;
  for (const u of due) {
    try {
      found += await scanUser(u, now);
    } catch (err) {
      // Nothing was marked read, so the next check (looking back an hour) tries the same mail again. The very first
      // look, over the last week, starts over.
      console.error(`Reading mail for user ${u.id} failed:`, err);
      if (!u.since) await sql`update users set mail_checked_at = null where id = ${u.id}`;
    }
  }
  await sql`delete from mail_finds where created_at < now() - interval '30 days'`;
  await sql`delete from mail_seen where seen_at < now() - interval '2 days'`;
  return found;
}

async function scanUser(u: MailUser, now: Date) {
  // Gmail's search lists a new email only after a delay, so each check looks back an hour, skipping what's been read.
  const since = u.since ? new Date(+u.since - LOOK_BACK_MS) : new Date(+now - FIRST_LOOK_DAYS * 86_400_000);
  // The Primary tab, said as "not the other tabs": some accounts don't tag mail as primary at all.
  const q = `in:inbox -category:promotions -category:social -category:updates -category:forums -from:me after:${Math.floor(+since / 1000)}`;
  const list = await google<{ messages?: { id: string }[] }>(u.id, `${GMAIL}/messages?maxResults=30&q=${encodeURIComponent(q)}`);
  const ids = (list.messages ?? []).map((m) => m.id);
  if (!ids.length) return 0;
  const seen = new Set((await sql<{ message_id: string }[]>`select message_id from mail_seen where user_id = ${u.id} and message_id = any(${ids})`).map((s) => s.message_id));
  const fresh = ids.filter((id) => !seen.has(id));
  if (!fresh.length) return 0;

  const mails: Mail[] = [];
  for (const id of fresh) {
    const m = await google<{ id: string; threadId: string; internalDate: string; payload: Part }>(u.id, `${GMAIL}/messages/${id}?format=full`);
    if (skip(m.payload)) continue;
    const text = textOf(m.payload);
    if (text) mails.push({ id: m.id, thread: m.threadId, from: header(m.payload, "From"), subject: header(m.payload, "Subject").slice(0, 200), sent: new Date(+m.internalDate), text });
  }

  const finds: { f: Find; m: Mail }[] = [];
  for (let i = 0; i < mails.length; i += BATCH) {
    const batch = mails.slice(i, i + BATCH);
    const raw = await askJson(SYSTEM, prompt(batch, now, u.timezone), 60_000);
    for (const f of parseFinds(raw, batch.length, now, u.timezone)) finds.push({ f, m: batch[f.mail] });
  }
  // Read: only now that the AI has answered for all of them (if it failed, they're tried again next minute).
  await sql`insert into mail_seen ${sql(fresh.map((message_id) => ({ user_id: u.id, message_id })))} on conflict do nothing`;
  if (!finds.length) return 0;

  // What's on the calendar over the days the finds are on, to put a meeting "sometime tomorrow" in free time.
  const { calendars, events } = await upcoming(u, midnightIn(finds.map((x) => x.f.day).sort()[0], u.timezone), 61);
  const busy = events.filter((e) => e.busy && !e.allDay).map(({ start, end }) => ({ start, end, allDay: false, busy: true }));
  const free = (from: Date, to: Date, minutes: number) => freeSlots(busy, from, to, minutes)[0]?.start ?? null;

  const saved: MailFind[] = [];
  for (const { f, m } of finds) {
    const when = whenOf(f, now, u.timezone, free);
    if (!when) continue;
    const [row] = await sql<MailFind[]>`
      insert into mail_finds (user_id, message_id, thread_id, kind, title, start_at, end_at, summary, quote, sender)
      values (${u.id}, ${m.id}, ${m.thread ?? null}, ${f.kind}, ${f.title}, ${when.start}, ${when.end}, ${f.summary}, ${f.quote}, ${senderName(m.from).slice(0, 120)})
      on conflict do nothing
      returning ${sql.unsafe(FIELDS)}`;
    if (!row) continue;
    if (when.end) busy.push({ start: when.start.toISOString(), end: when.end.toISOString(), allDay: false, busy: true }); // the next find won't take this time
    if (u.plan_mode === "auto") await addFind(u, row, calendars);
    saved.push(row);
  }
  if (!saved.length) return 0;

  const line = saved.map((s) => `${s.title} · ${whenText(s, u.timezone)}`).join(" · ");
  await sendPush(
    u.id,
    u.plan_mode === "auto"
      ? { kind: "digest", title: `Added from your email (${saved.length})`, body: line }
      : { kind: "digest", title: `Found in your email: ${saved.length} to add. Add ${saved.length === 1 ? "it" : "them"}?`, body: line },
  );
  return saved.length;
}

// "Fri 4:00 pm" or "due Fri 13 Nov, 11:59 pm"
export function whenText(s: Pick<MailFind, "start_at" | "end_at">, timeZone: string) {
  const at = new Date(s.start_at).toLocaleString("en-IN", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return s.end_at ? at : `due ${at}`;
}

// Puts a find on the calendar: a meeting or call as an event on your main calendar (no guests, so nobody is
// emailed), a deadline as a to-do due then. Marked added either way.
export async function addFind(u: User & { email: string }, f: MailFind, calendars?: Cal[]) {
  if (f.end_at) {
    await bookBlock(u, calendars ?? (await listCalendars(u.id)), {
      title: f.title,
      start: new Date(f.start_at),
      end: new Date(f.end_at),
      description: `${f.summary || `“${f.quote}”`} (email from ${f.sender})\n${gmailLink(u.email, f.thread_id)}`,
    });
  } else {
    await sql`insert into todos (user_id, title, due_at, minutes) values (${u.id}, ${f.title}, ${f.start_at}, 60)`;
  }
  await sql`update mail_finds set status = 'added' where id = ${f.id}`;
}

export const waitingFinds = (userId: string) =>
  sql<MailFind[]>`
    select ${sql.unsafe(FIELDS)} from mail_finds
    where user_id = ${userId} and status = 'waiting' and start_at > now()
    order by start_at`;
