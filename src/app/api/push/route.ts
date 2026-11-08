import { createHash } from "node:crypto";
import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { appOrigin, FCM_PREFIX, isFcmToken, isPushEndpoint, sendPush } from "@/lib/push";

const KEY = /^[A-Za-z0-9_-]{1,200}={0,2}$/;
// Devices are named to the browser by a short fingerprint of their push address, never the address itself.
const idOf = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex").slice(0, 16);
const deviceName = (v: unknown) => (typeof v === "string" ? v.replace(/[^\p{L}\p{N} ()+.-]/gu, "").trim().slice(0, 60) : "") || null;

// GET /api/push → your devices that get notifications on this site: [{id, device, addedAt, seenAt}].
export async function GET() {
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: "signin" }, { status: 401 });
  const rows = await sql<{ endpoint: string; device: string | null; created_at: Date; seen_at: Date }[]>`
    select endpoint, device, created_at, seen_at from push_subscriptions where user_id = ${userId} and origin = ${appOrigin()}
    order by seen_at desc`;
  return Response.json(rows.map((r) => ({ id: idOf(r.endpoint), device: r.device, addedAt: r.created_at, seenAt: r.seen_at })));
}

// POST /api/push {endpoint, keys:{p256dh, auth}, device} or {fcm, device} (Android app) → this device gets notifications, for whoever is signed in
// (sent again each time the app opens, so a device follows the account in use and comes back if it was dropped).
// POST /api/push {test: true, id?} → a test notification to one of your devices, or to all of them.
export async function POST(req: Request) {
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: "signin" }, { status: 401 });
  const body = await req.json().catch(() => null);

  if (body?.test === true) {
    const only: string | undefined = typeof body.id === "string" ? body.id : undefined;
    const devices = await sendPush(userId, { title: "Almanac", body: "Notifications are working ✓" }, only ? (e) => idOf(e) === only : undefined);
    return Response.json({ devices });
  }

  // {fcm: token}: the Android app (no browser keys; Firebase delivers it).
  const app = isFcmToken(body?.fcm);
  const endpoint = app ? FCM_PREFIX + body.fcm : body?.endpoint;
  const { p256dh, auth: secret } = app ? { p256dh: "", auth: "" } : (body?.keys ?? {});
  if (!app && (typeof endpoint !== "string" || endpoint.length > 1000 || !isPushEndpoint(endpoint) || !KEY.test(p256dh) || !KEY.test(secret))) {
    return Response.json({ error: "Invalid subscription" }, { status: 400 });
  }
  const device = deviceName(body?.device);
  await sql`
    insert into push_subscriptions (endpoint, user_id, p256dh, auth, origin, device) values (${endpoint}, ${userId}, ${p256dh}, ${secret}, ${appOrigin()}, ${device})
    on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, origin = excluded.origin,
      device = coalesce(excluded.device, push_subscriptions.device), seen_at = now()`;
  return Response.json({ ok: true });
}

// DELETE /api/push {endpoint} (this device) or {id} (one from the list) → it stops getting notifications.
export async function DELETE(req: Request) {
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: "signin" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (typeof body?.endpoint === "string") {
    await sql`delete from push_subscriptions where endpoint = ${body.endpoint} and user_id = ${userId}`;
  } else if (typeof body?.id === "string") {
    const rows = await sql<{ endpoint: string }[]>`select endpoint from push_subscriptions where user_id = ${userId}`;
    const hit = rows.find((r) => idOf(r.endpoint) === body.id);
    if (hit) await sql`delete from push_subscriptions where endpoint = ${hit.endpoint} and user_id = ${userId}`;
  } else return Response.json({ error: "Invalid request" }, { status: 400 });
  return Response.json({ ok: true });
}
