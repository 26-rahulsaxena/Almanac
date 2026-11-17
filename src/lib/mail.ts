// "Read my email": every minute, new mail in the Primary inbox is read by the AI for meetings, calls and
// deadlines. In Ask-first mode these wait in "Found in your email" for Add / Not now; in Automatic mode they go
// straight onto the calendar (meetings and calls as events, deadlines as to-dos). Never invites anyone.
// The email text is only passed to the AI; nothing of it is kept except a short quote of what was found.

import { GMAIL_SCOPE } from "@/auth";
import { askJson, hasAi } from "./ai";
import { listCalendars, type Cal } from "./calendar";
import { sql } from "./db";
import { googleAs, type GoogleAccount } from "./google";
import { gmailLink, header, parseFinds, prompt, senderEmail, senderName, skip, SYSTEM, textOf, whenOf, type Find, type Kind, type Mail, type Part } from "./mail-parse";
import { midnightIn } from "./reminders";
import { bookBlock, upcoming, type User } from "./planner";
import { sendPush } from "./push";
import { freeSlots } from "./time";
import { InvalidInput } from "./validate";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const FIRST_LOOK_DAYS = 7; // when switched on, how far back it reads
const BATCH = 8; // emails per AI question
const LOOK_BACK_MS = 3_600_000;

type MailUser = User & { email: string; plan_mode: "ask" | "auto"; since: Date | null };
// An inbox to read. since: when it was last read (null: never, so look back a week).
type Inbox = GoogleAccount & { email: string; since: Date | null };
// thread_id: the email's conversation (finds from before it was kept use the email itself, the same for a first message).
// account_email: the inbox it came from (null: from before more than one could be read, so the main one).
// pick_time: a meeting or call the email gave no time for; start_at is only Almanac's suggestion, you pick.
export type MailFind = { id: string; message_id: string; thread_id: string; kind: Kind; title: string; start_at: Date; end_at: Date | null; summary: string; quote: string; sender: string; account_email: string | null; pick_time: boolean; sender_email: string | null };
export const FIELDS = "id, message_id, coalesce(thread_id, message_id) as thread_id, kind, title, start_at, end_at, summary, quote, sender, account_email, pick_time, sender_email";

// Users whose mail is due a read (switched on, Gmail allowed in at least one of their Google accounts, not already
// read this minute), each claimed so two minute-jobs never read the same mail twice. since: when it was last checked.
export async function scanAll(now = new Date()) {
  if (!hasAi()) return 0;
  const due = await sql<MailUser[]>`
    with due as (
      select u.id, u.mail_checked_at as since from users u
      -- every minute-job (50 s, as runs land a hair under a minute apart); the AI only runs when there's new mail
      where u.mail_on and (u.mail_checked_at is null or u.mail_checked_at < now() - interval '50 seconds')
        and exists (select 1 from google_accounts t where t.user_id = u.id and t.broken_at is null and t.scope like ${"%" + GMAIL_SCOPE + "%"})
      for update skip locked
    )
    update users u set mail_checked_at = now() from due where u.id = due.id
    returning u.id, u.timezone, u.hidden_calendars, u.email, u.plan_mode, due.since`;
  let found = 0;
  for (const u of due) {
    try {
      found += await scanUser(u, now);
    } catch (err) {
      console.error(`Reading mail for user ${u.id} failed:`, err);
    }
  }
  await sql`delete from mail_finds where created_at < now() - interval '30 days'`;
  await sql`delete from mail_seen where seen_at < now() - interval '2 days'`;
  return found;
}

// Every connected inbox that allows Gmail, one after another (one failing doesn't stop the rest), then one
// notification for all that was found.
async function scanUser(u: MailUser, now: Date) {
  const inboxes = await sql<Inbox[]>`
    select id, is_main as main, email, coalesce(mail_checked_at, case when is_main then ${u.since}::timestamptz end) as since
    from google_accounts
    where user_id = ${u.id} and broken_at is null and scope like ${"%" + GMAIL_SCOPE + "%"}
    order by is_main desc, created_at`;
  const saved: MailFind[] = [];
  for (const inbox of inboxes) {
    try {
      saved.push(...(await scanInbox(u, inbox, now)));
      await sql`update google_accounts set mail_checked_at = ${now} where id = ${inbox.id}`;
    } catch (err) {
      // Nothing was marked read, so the next check tries the same mail again (the very first look, over the last
      // week, starts over).
      console.error(`Reading mail in account ${inbox.id} failed:`, err);
    }
  }
  if (!saved.length) return 0;

  // Automatic adds what has a time; one you pick a time for waits either way.
  const waiting = saved.filter((s) => u.plan_mode !== "auto" || s.pick_time);
  const added = saved.length - waiting.length;
  const line = saved.map((s) => `${s.title} · ${s.pick_time ? "pick a time" : whenText(s, u.timezone)}`).join(" · ");
  await sendPush(
    u.id,
    !waiting.length
      ? { kind: "digest", title: `Added from your email (${added})`, body: line }
      : { kind: "digest", title: `Found in your email: ${waiting.length} to add${added ? ` (${added} added)` : ""}. Add ${waiting.length === 1 ? "it" : "them"}?`, body: line },
  );
  return saved.length;
}

async function scanInbox(u: MailUser, inbox: Inbox, now: Date): Promise<MailFind[]> {
  // Gmail's search lists a new email only after a delay, so each check looks back an hour, skipping what's been read.
  const since = inbox.since ? new Date(+inbox.since - LOOK_BACK_MS) : new Date(+now - FIRST_LOOK_DAYS * 86_400_000);
  // The Primary tab, said as "not the other tabs": some accounts don't tag mail as primary at all.
  const q = `in:inbox -category:promotions -category:social -category:updates -category:forums -from:me after:${Math.floor(+since / 1000)}`;
  const list = await googleAs<{ messages?: { id: string }[] }>(inbox, `${GMAIL}/messages?maxResults=30&q=${encodeURIComponent(q)}`);
  const ids = (list.messages ?? []).map((m) => m.id);
  if (!ids.length) return [];
  // shortcut: read emails are remembered by Gmail id alone, not per inbox; ids are 64-bit and in practice never repeat
  // across inboxes, so a clash would only skip one email. Key mail_seen by account too if that ever matters.
  const seen = new Set((await sql<{ message_id: string }[]>`select message_id from mail_seen where user_id = ${u.id} and message_id = any(${ids})`).map((s) => s.message_id));
  const fresh = ids.filter((id) => !seen.has(id));
  if (!fresh.length) return [];

  const mails: Mail[] = [];
  for (const id of fresh) {
    const m = await googleAs<{ id: string; threadId: string; internalDate: string; payload: Part }>(inbox, `${GMAIL}/messages/${id}?format=full`);
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
  if (!finds.length) return [];

  // What's on the calendar over the days the finds are on, to put a meeting "sometime tomorrow" in free time.
  const { calendars, events } = await upcoming(u, midnightIn(finds.map((x) => x.f.day).sort()[0], u.timezone), 61, true);
  const busy = events.filter((e) => e.busy && !e.allDay).map(({ start, end }) => ({ start, end, allDay: false, busy: true }));
  const free = (from: Date, to: Date, minutes: number) => freeSlots(busy, from, to, minutes)[0]?.start ?? null;

  const saved: MailFind[] = [];
  for (const { f, m } of finds) {
    const when = whenOf(f, now, u.timezone, free);
    if (!when) continue;
    const [row] = await sql<MailFind[]>`
      insert into mail_finds (user_id, message_id, thread_id, kind, title, start_at, end_at, summary, quote, sender, account_email, pick_time, sender_email)
      values (${u.id}, ${m.id}, ${m.thread ?? null}, ${f.kind}, ${f.title}, ${when.start}, ${when.end}, ${f.summary}, ${f.quote}, ${senderName(m.from).slice(0, 120)}, ${inbox.main ? null : inbox.email}, ${f.kind !== "deadline" && !f.time}, ${senderEmail(m.from)})
      on conflict do nothing
      returning ${sql.unsafe(FIELDS)}`;
    if (!row) continue;
    if (when.end) busy.push({ start: when.start.toISOString(), end: when.end.toISOString(), allDay: false, busy: true }); // the next find won't take this time
    if (u.plan_mode === "auto" && !row.pick_time) await addFind(u, row, calendars);
    saved.push(row);
  }
  return saved;
}

// "Fri 4:00 pm" or "due Fri 13 Nov, 11:59 pm"
export function whenText(s: Pick<MailFind, "start_at" | "end_at">, timeZone: string) {
  const at = new Date(s.start_at).toLocaleString("en-IN", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return s.end_at ? at : `due ${at}`;
}

// Puts a find on the calendar: a meeting or call as an event, a deadline as a to-do due then. Marked added either way.
// invite (you pressed Add with Invite ticked): the sender becomes a guest and Google emails them the invite, sent from
// the inbox they wrote to (its own calendar), with no notes of yours in it. Otherwise no guests, and your notes and
// the email's link go in the description; it goes where new events go.
export async function addFind(u: User & { email: string }, f: MailFind, calendars?: Cal[], invite = false) {
  if (f.end_at) {
    const cals = calendars ?? (await listCalendars(u.id));
    const inbox = f.account_email ?? u.email;
    const guest = invite ? await senderOf(u, f) : null;
    if (invite && !guest) throw new InvalidInput("Couldn't find the sender's address. Untick Invite to add it without one.");
    const asked = guest && guest !== inbox.toLowerCase() ? guest : null; // you emailed this inbox yourself: no invite to send
    const own = asked && cals.find((c) => c.account === inbox && c.primary && c.canEdit);
    await bookBlock(u, own ? [own] : cals, {
      title: f.title,
      start: new Date(f.start_at),
      end: new Date(f.end_at),
      description: asked ? undefined : `${f.summary || `“${f.quote}”`} (email from ${f.sender})\n${gmailLink(inbox, f.thread_id)}`,
      guests: asked ? [asked] : undefined,
    });
  } else {
    await sql`insert into todos (user_id, title, due_at, minutes) values (${u.id}, ${f.title}, ${f.start_at}, 60)`;
  }
  await sql`update mail_finds set status = 'added' where id = ${f.id}`;
}

// The sender's address: kept with the find, or (found before addresses were kept) read again from the email's From.
async function senderOf(u: User, f: MailFind) {
  if (f.sender_email) return f.sender_email;
  const [inbox] = await sql<GoogleAccount[]>`
    select id, is_main as main from google_accounts
    where user_id = ${u.id} and (email = ${f.account_email} or (${f.account_email}::text is null and is_main))`;
  if (!inbox) return null;
  const m = await googleAs<{ payload: Part }>(inbox, `${GMAIL}/messages/${f.message_id}?format=metadata&metadataHeaders=From`).catch(() => null);
  return m ? senderEmail(header(m.payload, "From")) : null;
}

export const waitingFinds = (userId: string) =>
  sql<MailFind[]>`
    select ${sql.unsafe(FIELDS)} from mail_finds
    where user_id = ${userId} and status = 'waiting' and start_at > now()
    order by start_at`;
