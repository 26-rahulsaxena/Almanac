// The inbox: your Gmail, read and answered inside Almanac, every connected Google account in one list. Nothing of it
// is kept in Almanac's database: each list, conversation and attachment is fetched from Gmail when you open it.
// Accounts from before gmail.modify can only read; acting on mail (archive, star, send…) asks them to Allow again.

import { sql } from "./db";
import { GoogleError, googleAs, type GoogleAccount } from "./google";
import { header, senderEmail, senderName, textOf, type Part } from "./mail-parse";
import { InvalidInput } from "./validate";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const PAGE = 20; // conversations per account per page
const PARALLEL = 8; // Gmail calls at once per account (its per-user quota allows short bursts, not 20+ at once)

export type InboxAccount = GoogleAccount & { email: string; send: boolean };
// Primary: the Primary tab, said as "not the other tabs" (some accounts don't tag mail as primary at all).
export const VIEWS = {
  primary: "in:inbox -category:promotions -category:social -category:updates -category:forums",
  inbox: "in:inbox",
  starred: "is:starred",
  sent: "in:sent",
  all: "", // anywhere but Spam and Bin (a person's emails, with a search)
} as const;
export type View = keyof typeof VIEWS;

export type ThreadRow = {
  id: string;
  account: string; // the Google account's id in Almanac
  accountEmail: string;
  subject: string;
  people: string; // who's in it, by first name: "Priya, me (3)"
  snippet: string;
  date: string; // the latest message
  unread: boolean;
  starred: boolean;
  inbox: boolean;
  count: number;
};
// cid: the picture's Content-ID, when the email's HTML shows it inline ("<img src=cid:…>").
export type Attachment = { id: string; name: string; mime: string; size: number; cid: string | null };
export type Message = {
  id: string;
  from: string;
  fromEmail: string | null;
  to: string;
  cc: string;
  date: string;
  subject: string;
  html: string | null;
  text: string;
  attachments: Attachment[];
  unread: boolean;
};

// The user's accounts that allow Gmail (either permission, as auth.ts's MAIL_READ), and aren't waiting to be reconnected.
export const inboxAccounts = (userId: string) =>
  sql<InboxAccount[]>`
    select id, is_main as main, email, scope like '%/gmail.modify%' as send from google_accounts
    where user_id = ${userId} and broken_at is null and scope like '%/auth/gmail.%'
    order by is_main desc, created_at`;

export async function inboxAccount(userId: string, id: unknown, act = false) {
  if (typeof id !== "string") throw new InvalidInput("Pick an account.");
  const a = (await inboxAccounts(userId)).find((x) => x.id === id);
  if (!a) throw new InvalidInput("That Google account isn't connected any more.");
  if (act && !a.send) throw new AllowError(a.email);
  return a;
}

// This account only allowed reading: Allow again (Google's screen) before replying, archiving and so on.
export class AllowError extends Error {
  constructor(readonly email: string) {
    super(`Allow Almanac to manage ${email}'s Gmail first.`);
  }
}

// Gmail said the login lacks the permission (allowed reading only, or unticked on Google's screen).
export const scopeMissing = (err: unknown) => err instanceof GoogleError && err.status === 403 && err.body.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT");

// Runs fn over items, PARALLEL at a time (also used by people.ts).
export async function pool<T, R>(items: T[], fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, worker));
  return out;
}

type RawMsg = { id: string; threadId: string; labelIds?: string[]; internalDate: string; snippet?: string; payload: Part };

// "Priya Shah <p@x.com>" → "Priya"; your own address → "me".
const firstName = (from: string, me: string) => (senderEmail(from) === me.toLowerCase() ? "me" : senderName(from).split(/[\s@]/)[0] || from);

// Strips Gmail's HTML entities from a snippet ("It&#39;s" → "It's").
const unentity = (s: string) =>
  s.replace(/&(#\d+|amp|lt|gt|quot|#39);/g, (m, e: string) => (e[0] === "#" ? String.fromCharCode(+e.slice(1)) : { amp: "&", lt: "<", gt: ">", quot: '"' }[e] ?? m));

export function rowOf(a: InboxAccount, id: string, msgs: RawMsg[], snippet: string): ThreadRow {
  const last = msgs[msgs.length - 1];
  const names = [...new Set(msgs.map((m) => firstName(header(m.payload, "From"), a.email)))];
  const labels = new Set(msgs.flatMap((m) => m.labelIds ?? []));
  return {
    id,
    account: a.id,
    accountEmail: a.email,
    subject: header(msgs[0].payload, "Subject") || "(no subject)",
    people: names.slice(-3).join(", ") + (msgs.length > 1 ? ` (${msgs.length})` : ""),
    snippet: unentity(snippet || last.snippet || ""),
    date: new Date(+last.internalDate).toISOString(),
    unread: labels.has("UNREAD"),
    starred: labels.has("STARRED"),
    inbox: labels.has("INBOX"),
    count: msgs.length,
  };
}

// One page of conversations from every account, newest first. page: each account's next-page token from the last
// call (an account missing from it has no more). failed: accounts Gmail wouldn't list right now.
// account: only this one (the mailbox picked in Mail's drawer); otherwise every account.
// shortcut: each account pages on its own, so page 2 of one can hold mail older than page 1 of another; fine for a
// person's handful of accounts. Merge by date across pages (keep a buffer) if it ever looks wrong.
export async function listThreads(userId: string, view: View, search: string, page?: Record<string, string>, account?: string) {
  const accounts = (await inboxAccounts(userId)).filter((a) => (!page || page[a.id]) && (!account || a.id === account));
  const q = `${VIEWS[view]} ${search}`.trim();
  const next: Record<string, string> = {};
  const failed: string[] = [];
  const lists = await Promise.all(
    accounts.map(async (a) => {
      try {
        const token = page?.[a.id] ? `&pageToken=${encodeURIComponent(page[a.id])}` : "";
        const l = await googleAs<{ threads?: { id: string; snippet: string }[]; nextPageToken?: string }>(a, `${GMAIL}/threads?maxResults=${PAGE}&q=${encodeURIComponent(q)}${token}`);
        if (l.nextPageToken) next[a.id] = l.nextPageToken;
        return await pool(l.threads ?? [], async (t) => {
          const full = await googleAs<{ messages: RawMsg[] }>(a, `${GMAIL}/threads/${t.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
          return rowOf(a, t.id, full.messages, t.snippet);
        });
      } catch (err) {
        console.error(`Listing mail in account ${a.id} failed:`, err);
        failed.push(a.email);
        return [];
      }
    }),
  );
  const threads = lists.flat().sort((x, y) => y.date.localeCompare(x.date));
  return { threads, next: Object.keys(next).length ? next : null, failed };
}

// Unread conversations in each account's Primary inbox, counted from the list itself (Gmail's own "estimate" was
// off by 5x), up to 500 each. An account Gmail won't answer for counts 0.
export async function unreadCounts(userId: string) {
  const q = encodeURIComponent(`${VIEWS.primary} is:unread`);
  return Promise.all(
    (await inboxAccounts(userId)).map(async (a) => ({
      id: a.id,
      unread: await googleAs<{ threads?: unknown[] }>(a, `${GMAIL}/threads?maxResults=500&fields=threads(id)&q=${q}`).then((r) => r.threads?.length ?? 0, () => 0),
    })),
  );
}

const decode = (data?: string) => (data ? Buffer.from(data, "base64url").toString("utf8") : "");
const all = (p: Part): Part[] => [p, ...(p.parts ?? []).flatMap(all)];

// An email's bodies (its HTML, if any, and plain text) and its attachments, from Gmail's nested parts.
export function bodyOf(p: Part) {
  const parts = all(p);
  const html = parts.find((x) => x.mimeType === "text/html" && !x.filename)?.body?.data;
  const text = parts.find((x) => x.mimeType === "text/plain" && !x.filename)?.body?.data;
  const attachments = parts
    .filter((x) => x.body?.attachmentId && (x.filename || header(x, "Content-ID")))
    .map((x) => ({
      id: x.body!.attachmentId!,
      name: x.filename || "picture",
      mime: x.mimeType ?? "application/octet-stream",
      size: x.body!.size ?? 0,
      cid: header(x, "Content-ID").replace(/^<|>$/g, "") || null,
    }));
  return { html: html ? decode(html) : null, text: decode(text), attachments };
}

export async function getThread(a: InboxAccount, threadId: string): Promise<Message[]> {
  const t = await googleAs<{ messages: RawMsg[] }>(a, `${GMAIL}/threads/${encodeURIComponent(threadId)}?format=full`);
  return t.messages.map((m) => {
    const from = header(m.payload, "From");
    return {
      id: m.id,
      from,
      fromEmail: senderEmail(from),
      to: header(m.payload, "To"),
      cc: header(m.payload, "Cc"),
      date: new Date(+m.internalDate).toISOString(),
      subject: header(m.payload, "Subject"),
      unread: !!m.labelIds?.includes("UNREAD"),
      ...bodyOf(m.payload),
    };
  });
}

// A conversation's latest messages as short plain text (quoted replies cut off), for the assistant to read.
export async function threadText(a: InboxAccount, threadId: string, last = 5) {
  const t = await googleAs<{ messages: RawMsg[] }>(a, `${GMAIL}/threads/${encodeURIComponent(threadId)}?format=full`);
  return t.messages.slice(-last).map((m) => ({
    id: m.id,
    from: header(m.payload, "From"),
    to: header(m.payload, "To"),
    cc: header(m.payload, "Cc"),
    subject: header(m.payload, "Subject"),
    date: new Date(+m.internalDate),
    text: textOf(m.payload),
  }));
}

export async function getAttachment(a: InboxAccount, messageId: string, attachmentId: string) {
  const r = await googleAs<{ data: string }>(a, `${GMAIL}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
  return Buffer.from(r.data, "base64url");
}

// Each action and its undo. Trash goes to Gmail's Bin (kept 30 days), never deleted for good.
export const ACTIONS = {
  archive: { remove: ["INBOX"] },
  unarchive: { add: ["INBOX"] },
  read: { remove: ["UNREAD"] },
  unread: { add: ["UNREAD"] },
  star: { add: ["STARRED"] },
  unstar: { remove: ["STARRED"] },
  trash: "trash",
  untrash: "untrash",
} as const;
export type Action = keyof typeof ACTIONS;

export async function act(a: InboxAccount, threadId: string, action: Action) {
  const what = ACTIONS[action];
  const path = `${GMAIL}/threads/${encodeURIComponent(threadId)}`;
  if (typeof what === "string") return googleAs(a, `${path}/${what}`, { method: "POST" });
  const body = { addLabelIds: "add" in what ? what.add : [], removeLabelIds: "remove" in what ? what.remove : [] };
  return googleAs(a, `${path}/modify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

// --- Sending ---

export type Outgoing = { to: string[]; cc: string[]; bcc: string[]; subject: string; body: string; inReplyTo?: string; references?: string };
const MAX_RECIPIENTS = 50;
const ADDRESS = /^[^\s@<>",;:()[\]\\]+@[^\s@<>",;:()[\]\\]+\.[^\s@<>",;:()[\]\\]+$/;

// "Priya <p@x.com>, q@y.com" → ["p@x.com", "q@y.com"]. Names are dropped (Gmail shows its own contact names), which
// also means nothing typed here can reach the email's headers but a plain address.
export function parseAddresses(v: unknown, field: string): string[] {
  if (v == null || v === "") return [];
  if (typeof v !== "string" || v.length > 5000) throw new InvalidInput(`Check the ${field} addresses.`);
  const out = v
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (/<([^>]+)>\s*$/.exec(s)?.[1] ?? s).trim());
  const bad = out.find((x) => !ADDRESS.test(x));
  if (bad) throw new InvalidInput(`“${bad.slice(0, 60)}” in ${field} isn't an email address.`);
  return out;
}

// RFC 2047: a header with anything but plain ASCII goes as UTF-8 base64 ("=?UTF-8?B?…?=").
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
const wrap = (b64: string) => b64.replace(/.{76}/g, "$&\r\n");

// The email as Gmail wants it (RFC 2822, base64url). From is left out: Gmail fills in the account's own address.
export function buildMime(m: Outgoing) {
  for (const h of [m.subject, m.inReplyTo ?? "", m.references ?? ""]) if (/[\r\n]/.test(h)) throw new InvalidInput("Line breaks aren't allowed there.");
  const lines = [
    m.to.length && `To: ${m.to.join(", ")}`,
    m.cc.length && `Cc: ${m.cc.join(", ")}`,
    m.bcc.length && `Bcc: ${m.bcc.join(", ")}`,
    `Subject: ${encodeHeader(m.subject)}`,
    m.inReplyTo && `In-Reply-To: ${m.inReplyTo}`,
    m.references && `References: ${m.references}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ].filter(Boolean);
  const raw = `${lines.join("\r\n")}\r\n\r\n${wrap(Buffer.from(m.body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64"))}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

export function parseOutgoing(b: Record<string, unknown>): Outgoing {
  const to = parseAddresses(b.to, "To");
  const cc = parseAddresses(b.cc, "Cc");
  const bcc = parseAddresses(b.bcc, "Bcc");
  if (!to.length && !cc.length && !bcc.length) throw new InvalidInput("Add who it's to.");
  if (to.length + cc.length + bcc.length > MAX_RECIPIENTS) throw new InvalidInput(`Up to ${MAX_RECIPIENTS} people at once.`);
  const subject = typeof b.subject === "string" ? b.subject.trim() : "";
  if (subject.length > 300) throw new InvalidInput("Keep the subject under 300 characters.");
  const body = typeof b.body === "string" ? b.body : "";
  if (body.length > 100_000) throw new InvalidInput("That message is too long.");
  if (!subject && !body.trim()) throw new InvalidInput("Write something first.");
  return { to, cc, bcc, subject, body };
}

// Sends from this account. replyTo: the Gmail id of the message being answered; the reply joins its conversation,
// with the headers that thread it for everyone else's mail app too (read from Gmail, not trusted from the browser).
export async function send(a: InboxAccount, m: Outgoing, replyTo?: string) {
  let threadId: string | undefined;
  if (replyTo) {
    const o = await googleAs<RawMsg>(
      a,
      `${GMAIL}/messages/${encodeURIComponent(replyTo)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Subject`,
    );
    const id = header(o.payload, "Message-ID");
    threadId = o.threadId;
    const one = (s: string) => s.replace(/s+/g, " ").trim(); // a long header can come folded over lines
    if (id) m = { ...m, inReplyTo: one(id), references: one(`${header(o.payload, "References")} ${id}`) };
    const subj = header(o.payload, "Subject");
    if (!m.subject) m = { ...m, subject: /^re:/i.test(subj) ? subj : `Re: ${subj}` };
  }
  return googleAs<{ id: string; threadId: string }>(a, `${GMAIL}/messages/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw: buildMime(m), threadId }),
  });
}
