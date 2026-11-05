import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { appOrigin, isPushEndpoint, sendPush } from "@/lib/push";

const KEY = /^[A-Za-z0-9_-]{1,200}={0,2}$/;

// POST /api/push {endpoint, keys:{p256dh, auth}} → this device gets notifications, for whoever is signed in (sent
// again each time the app opens, so a device follows the account in use and comes back if it was dropped).
// POST /api/push {test: true} → send a test notification to all your devices.
// DELETE /api/push {endpoint} → this device stops getting them.
export async function POST(req: Request) {
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: "signin" }, { status: 401 });
  const body = await req.json().catch(() => null);

  if (body?.test === true) {
    const devices = await sendPush(userId, { title: "Almanac", body: "Notifications are working ✓" });
    return Response.json({ devices });
  }

  const endpoint = body?.endpoint;
  const { p256dh, auth: secret } = body?.keys ?? {};
  if (typeof endpoint !== "string" || endpoint.length > 1000 || !isPushEndpoint(endpoint) || !KEY.test(p256dh) || !KEY.test(secret)) {
    return Response.json({ error: "Invalid subscription" }, { status: 400 });
  }
  await sql`
    insert into push_subscriptions (endpoint, user_id, p256dh, auth, origin) values (${endpoint}, ${userId}, ${p256dh}, ${secret}, ${appOrigin()})
    on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, origin = excluded.origin`;
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: "signin" }, { status: 401 });
  const endpoint = (await req.json().catch(() => null))?.endpoint;
  if (typeof endpoint !== "string") return Response.json({ error: "Invalid request" }, { status: 400 });
  await sql`delete from push_subscriptions where endpoint = ${endpoint} and user_id = ${userId}`;
  return Response.json({ ok: true });
}
