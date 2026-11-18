import { auth } from "@/auth";
import { GoogleError, ReauthError } from "@/lib/google";
import { act, ACTIONS, AllowError, getAttachment, getThread, inboxAccount, inboxAccounts, listThreads, parseOutgoing, scopeMissing, send, unreadCounts, VIEWS, type Action, type View } from "@/lib/inbox";
import { me } from "@/lib/planner";
import { InvalidInput } from "@/lib/validate";

const ID = /^[0-9a-f]{1,32}$/i; // Gmail's thread and message ids
const ATTACHMENT = /^[\w-]{1,2000}$/;
// Attachments a browser can show safely in place; anything else (HTML, SVG…) only downloads, so it can't run here.
const INLINE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]);
const fail = (error: string, status = 400) => Response.json({ error }, { status });

async function respond(run: () => Promise<Response>) {
  try {
    return await run();
  } catch (err) {
    if (err instanceof InvalidInput) return fail(err.message);
    if (err instanceof AllowError) return Response.json({ error: "allow", email: err.email }, { status: 403 });
    if (scopeMissing(err)) return Response.json({ error: "allow" }, { status: 403 });
    if (err instanceof ReauthError) return fail("reauth", 401);
    if (err instanceof GoogleError && err.status === 404) return fail("That email isn't there any more.", 404);
    console.error(err);
    return fail("Couldn't reach Gmail. Try again.", 502);
  }
}

// GET /api/inbox?view=primary|inbox|starred|sent&q=<Gmail search>&page=<JSON from next>&box=<account id> → {threads, next, failed, accounts}
// GET /api/inbox?counts=1 → [{id, unread}]: unread in each account's Primary inbox (Mail's drawer)
// GET /api/inbox?account=<id>&thread=<id> → {messages, send}: one conversation, oldest first
// GET /api/inbox?account=<id>&message=<id>&attachment=<id>&name=&mime= → the attachment's file
export async function GET(req: Request) {
  const u = await me((await auth())?.user?.id);
  if (!u) return fail("signin", 401);
  const p = new URL(req.url).searchParams;
  return respond(async () => {
    if (p.has("attachment")) {
      const a = await inboxAccount(u.id, p.get("account"));
      const message = p.get("message") ?? "";
      const id = p.get("attachment") ?? "";
      if (!ID.test(message) || !ATTACHMENT.test(id)) throw new InvalidInput("Invalid attachment");
      const mime = (p.get("mime") ?? "").toLowerCase();
      const name = (p.get("name") ?? "attachment").slice(0, 200);
      const inline = INLINE.has(mime);
      return new Response(new Uint8Array(await getAttachment(a, message, id)), {
        headers: {
          "Content-Type": inline ? mime : "application/octet-stream",
          "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
          "Content-Security-Policy": "sandbox", // even if a browser renders it, nothing in it runs as Almanac
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        },
      });
    }
    if (p.has("counts")) return Response.json(await unreadCounts(u.id));
    if (p.has("thread")) {
      const a = await inboxAccount(u.id, p.get("account"));
      const thread = p.get("thread") ?? "";
      if (!ID.test(thread)) throw new InvalidInput("Invalid conversation");
      return Response.json({ messages: await getThread(a, thread), send: a.send });
    }
    const view = (p.get("view") ?? "primary") as View;
    if (!Object.hasOwn(VIEWS, view)) throw new InvalidInput("Invalid view");
    const q = (p.get("q") ?? "").slice(0, 500);
    let page: Record<string, string> | undefined;
    if (p.has("page")) {
      try {
        page = JSON.parse(p.get("page")!);
      } catch {}
      if (!page || typeof page !== "object" || !Object.values(page).every((v) => typeof v === "string" && v.length < 500)) throw new InvalidInput("Invalid page");
    }
    const box = p.get("box") ?? undefined; // one account's mail (an id not theirs simply lists nothing)
    const [list, accounts] = await Promise.all([listThreads(u.id, view, q, page, box), inboxAccounts(u.id)]);
    return Response.json({ ...list, accounts: accounts.map(({ id, email, main, send }) => ({ id, email, main, send })) });
  });
}

// POST /api/inbox {action: archive|unarchive|read|unread|star|unstar|trash|untrash, account, thread} → {ok}
// POST /api/inbox {action: "send", account, to, cc?, bcc?, subject, body, replyTo?: message id} → {ok, thread}
export async function POST(req: Request) {
  const u = await me((await auth())?.user?.id);
  if (!u) return fail("signin", 401);
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return fail("Invalid request");
  return respond(async () => {
    const a = await inboxAccount(u.id, b.account, true);
    if (b.action === "send") {
      if (b.replyTo !== undefined && !ID.test(String(b.replyTo))) throw new InvalidInput("Invalid reply");
      const sent = await send(a, parseOutgoing(b), b.replyTo);
      return Response.json({ ok: true, thread: sent.threadId });
    }
    if (typeof b.action !== "string" || !Object.hasOwn(ACTIONS, b.action) || !ID.test(String(b.thread))) throw new InvalidInput("Invalid request");
    await act(a, b.thread, b.action as Action);
    return Response.json({ ok: true });
  });
}
