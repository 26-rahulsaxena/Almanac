// People: everyone you email with, gathered from Gmail's headers (From, To, Cc, never the email text) in every
// connected inbox: who you write to, and who writes to your Primary inbox, without newsletters and automated
// senders. Counted as it goes (every 10 minutes from the minute-job, or at once the first time People is opened),
// so the list opens instantly. Meetings and conversations with someone are read live when you open them.

import { sql } from "./db";
import { googleAs, type GoogleAccount } from "./google";
import { pool, VIEWS } from "./inbox";
import { header, skip, type Part } from "./mail-parse";
import { listCalendars, listEvents } from "./calendar";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const FIRST_LOOK = 150; // each way, the first time an inbox is looked at
const LATER_LOOK = 100; // each way, after that (10 minutes of mail; more waits for the next look)
const FIRST_DAYS = 180;
const LOOK_BACK_MS = 3_600_000; // Gmail's search lists a new email only after a delay
const ACCOUNTS_PER_RUN = 5; // per minute-job, so one run stays short

export type Person = { email: string; name: string; sent: number; received: number; last_at: Date | null };
type Meta = { internalDate: string; payload: Part };
type Tally = { name: string; sent: number; received: number; last: number };

// '"Shah, Priya" <P@x.com>, q@y.com' → [{name: "Shah, Priya", email: "p@x.com"}, {name: "", email: "q@y.com"}]
export function addressList(h: string): { name: string; email: string }[] {
  const out: { name: string; email: string }[] = [];
  const re = /\s*(?:"((?:[^"\\]|\\.)*)"|([^,"<]*?))\s*<([^>\s]+@[^>\s]+)>|([^\s,;<>"]+@[^\s,;<>"]+)/g;
  for (let m; (m = re.exec(h)); ) {
    const email = (m[3] ?? m[4]).toLowerCase().replace(/[.;]+$/, "");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue;
    out.push({ name: (m[1] ?? m[2] ?? "").replace(/\\(.)/g, "$1").trim(), email });
  }
  return out;
}

// Emails into counts per person. mine: your own addresses (an email from one of them was sent by you).
// A name is only taken when it isn't just the address again.
export function tally(msgs: Meta[], mine: Set<string>, into = new Map<string, Tally>()) {
  const add = (email: string, name: string, at: number, sent: boolean) => {
    if (mine.has(email)) return;
    const t = into.get(email) ?? { name: "", sent: 0, received: 0, last: 0 };
    if (name && !name.includes("@") && (!t.name || at >= t.last)) t.name = name;
    if (sent) t.sent++;
    else t.received++;
    t.last = Math.max(t.last, at);
    into.set(email, t);
  };
  for (const m of msgs) {
    const at = +m.internalDate;
    const [from] = addressList(header(m.payload, "From"));
    if (!from) continue;
    if (mine.has(from.email)) {
      for (const to of addressList(`${header(m.payload, "To")}, ${header(m.payload, "Cc")}`)) add(to.email, to.name, at, true);
    } else if (!skip(m.payload) && !automated(from.email)) add(from.email, from.name, at, false);
  }
  return into;
}

// A company's address rather than a person's ("service@updates.paypal.com", "partner@rapido.bike"): left out when
// they only ever wrote to you (someone you've written to counts whatever their address).
const ROLE = /^(partner|service|support|info|connect|hello|hi|team|alerts?|billing|orders?|receipts?|news(letter)?|updates?|marketing|accounts?|security|help|care|contact|notifications?|notify|mailer|bounces?|feedback|offers?|deals|promo(tions)?|rewards|statements?|transactions?|admin|sales|noreply|auto|system|digest|invoices?|payments?)([._-]|$)/;
const MAILER = /^(updates?|mail|email|e|em|news|notify|notifications?|info|alerts?|mailer|marketing|txn|transactional)./;
export const automated = (email: string) => {
  const [local, domain = ""] = email.split("@");
  return ROLE.test(local) || MAILER.test(domain);
};

type Claimed = GoogleAccount & { user_id: string; people_cursor: Date | null };

// Looks through one inbox's mail since it was last looked at, and adds what it finds to the person counts.
async function syncAccount(a: Claimed, mine: Set<string>) {
  const cursor = a.people_cursor ? +a.people_cursor : 0;
  const since = Math.floor((cursor ? cursor - LOOK_BACK_MS : Date.now() - FIRST_DAYS * 86_400_000) / 1000);
  const max = cursor ? LATER_LOOK : FIRST_LOOK;
  const ids = (
    await Promise.all(
      [`in:sent after:${since}`, `${VIEWS.primary} after:${since}`].map(async (q) => {
        const l = await googleAs<{ messages?: { id: string }[] }>(a, `${GMAIL}/messages?maxResults=${max}&q=${encodeURIComponent(q)}`);
        return (l?.messages ?? []).map((m) => m.id);
      }),
    )
  ).flat();
  const headers = ["From", "To", "Cc", "List-Unsubscribe", "Precedence"].map((h) => `&metadataHeaders=${h}`).join("");
  const msgs = (await pool([...new Set(ids)], (id) => googleAs<Meta>(a, `${GMAIL}/messages/${id}?format=metadata${headers}`))).filter((m) => +m.internalDate > cursor);
  const found = tally(msgs, mine);
  if (found.size) {
    const rows = [...found];
    await sql`
      insert into people (user_id, email, name, sent, received, last_at)
      select ${a.user_id}, * from unnest(
        ${rows.map(([e]) => e)}::text[], ${rows.map(([, t]) => t.name.slice(0, 120))}::text[],
        ${rows.map(([, t]) => t.sent)}::int[], ${rows.map(([, t]) => t.received)}::int[],
        ${rows.map(([, t]) => new Date(t.last).toISOString())}::timestamptz[])
      on conflict (user_id, email) do update set
        name = case when excluded.name <> '' and excluded.last_at >= coalesce(people.last_at, excluded.last_at) then excluded.name else people.name end,
        sent = people.sent + excluded.sent,
        received = people.received + excluded.received,
        last_at = greatest(people.last_at, excluded.last_at)
      where not people.hidden`;
  }
  // The newest email counted; nothing new: keep the old one (never move it past mail Gmail hasn't listed yet).
  const newest = Math.max(cursor, ...msgs.map((m) => +m.internalDate));
  await sql`update google_accounts set people_cursor = ${newest ? new Date(newest) : new Date()} where id = ${a.id}`;
  return found.size;
}

// Claims inboxes due a look (each claimed once, so two runs never count the same mail twice), then looks.
async function run(claimed: Claimed[]) {
  let found = 0;
  const mine = new Map<string, Set<string>>();
  for (const a of claimed) {
    try {
      if (!mine.has(a.user_id)) {
        const own = await sql<{ email: string }[]>`select email from google_accounts where user_id = ${a.user_id}`;
        mine.set(a.user_id, new Set(own.map((o) => o.email.toLowerCase())));
      }
      found += await syncAccount(a, mine.get(a.user_id)!);
    } catch (err) {
      console.error(`Gathering people in account ${a.id} failed:`, err); // tried again at the next look
    }
  }
  return found;
}

// The minute-job: a few inboxes not looked at for 10 minutes.
export async function syncPeople() {
  const claimed = await sql<Claimed[]>`
    update google_accounts g set people_checked_at = now()
    where g.id in (
      select id from google_accounts
      where broken_at is null and scope like '%/auth/gmail.%'
        and (people_checked_at is null or people_checked_at < now() - interval '10 minutes')
      order by people_checked_at nulls first limit ${ACCOUNTS_PER_RUN}
      for update skip locked)
    returning g.id, g.is_main as main, g.user_id, g.people_cursor`;
  return run(claimed);
}

// Opening People: this person's inboxes never looked at yet are looked at now (unless a run has just started on them).
export async function syncFirst(userId: string) {
  const claimed = await sql<Claimed[]>`
    update google_accounts g set people_checked_at = now()
    where g.id in (
      select id from google_accounts
      where user_id = ${userId} and broken_at is null and scope like '%/auth/gmail.%' and people_cursor is null
        and (people_checked_at is null or people_checked_at < now() - interval '2 minutes')
      for update skip locked)
    returning g.id, g.is_main as main, g.user_id, g.people_cursor`;
  return run(claimed);
}

export const listPeople = (userId: string) =>
  sql<Person[]>`
    select email, name, sent, received, last_at from people
    where user_id = ${userId} and not hidden
    order by last_at desc nulls last limit 1000`;

export async function getPerson(userId: string, email: string) {
  const [p] = await sql<Person[]>`select email, name, sent, received, last_at from people where user_id = ${userId} and email = ${email} and not hidden`;
  return p ?? null;
}

// Taken off the list for good: not shown, and not counted again.
export const hidePerson = (userId: string, email: string) =>
  sql`
    insert into people (user_id, email, hidden) values (${userId}, ${email}, true)
    on conflict (user_id, email) do update set hidden = true`;

// Meetings with them over the past and next year, from the calendars you show: Google's search matches guests,
// so only events they're actually a guest of are kept.
export async function meetingsWith(userId: string, email: string, hidden: string[], now = new Date()) {
  const cals = (await listCalendars(userId)).filter((c) => !hidden.includes(c.id));
  const year = 365 * 86_400_000;
  const events = await listEvents(userId, cals.map((c) => c.id), new Date(+now - year).toISOString(), new Date(+now + year).toISOString(), email);
  return events
    .filter((e) => e.attendees?.some((g) => g.email?.toLowerCase() === email))
    .map(({ id, calendarId, title, start, end, allDay }) => ({ id, calendarId, title, start, end, allDay }))
    .sort((x, y) => x.start.localeCompare(y.start));
}
