import webpush from "web-push";
import { sql } from "./db";

// kind "reminder" (default): id = reminder delivery, buttons Snooze / Done.
// kind "checkin": id = deadline, ask "start" (buttons Doing it now / Open) or "finished" (Yes, done / Need 30 more min).
// kind "digest": morning priorities summary, opens the priorities list.
export type PushPayload = { title: string; body: string; id?: string; kind?: "reminder" | "checkin" | "digest" | "review"; ask?: "start" | "finished"; snooze?: number };

// Push services run by browser makers. Only these may receive subscriptions, so nobody can make
// the server post to an arbitrary address.
const PUSH_HOSTS = /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)$/;

export function isPushEndpoint(endpoint: string) {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOSTS.test(u.hostname);
  } catch {
    return false;
  }
}

// The site this server runs as. Each device is saved with the site it switched notifications on from, and only
// gets this site's notifications (the live site and a copy on a computer share one database).
// shortcut: the copy on a computer is assumed to run at localhost:3000; set APP_ORIGIN if it runs elsewhere.
export const appOrigin = () =>
  process.env.APP_ORIGIN ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

// Sends to every device the user switched notifications on for. Returns how many devices it reached.
// only: limit it to some devices (e.g. the one being tested in Settings).
export async function sendPush(userId: string, payload: PushPayload, only?: (endpoint: string) => boolean) {
  const all = await sql<{ endpoint: string; p256dh: string; auth: string }[]>`
    select endpoint, p256dh, auth from push_subscriptions where user_id = ${userId} and origin = ${appOrigin()}`;
  const subs = only ? all.filter((s) => only(s.endpoint)) : all;
  const vapidDetails = {
    subject: process.env.VAPID_SUBJECT!,
    publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    privateKey: process.env.VAPID_PRIVATE_KEY!,
  };
  const results = await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), {
          TTL: 600,
          urgency: "high",
          vapidDetails,
        });
        return true;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410: the browser dropped this subscription (uninstalled, permission removed).
        if (status === 404 || status === 410) await sql`delete from push_subscriptions where endpoint = ${s.endpoint}`;
        else console.error("Push failed", status, (err as { body?: string }).body);
        return false;
      }
    }),
  );
  return results.filter(Boolean).length;
}
