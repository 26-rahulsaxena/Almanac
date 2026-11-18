"use server";
import { cookies } from "next/headers";
import { auth, signIn, signOut, withGmail } from "@/auth";
import { LINK_COOKIE, makeTicket } from "@/lib/accounts";
import { decrypt } from "@/lib/crypto";
import { sql } from "@/lib/db";
import { doneKeys } from "@/lib/planner";
import { cleanProfile, EMPTY_PROFILE } from "@/lib/profile";
import { SNOOZE_CHOICES } from "@/lib/reminders";

export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/" });
}

// "Read my email": switched on here, then Google asks to allow Gmail (website; the Android app goes through the
// phone's browser instead, see startAppSignIn).
export async function connectGmail() {
  await setMailOn(true);
  await signIn("google", { redirectTo: "/?mail=1" }, withGmail); // back to Settings → Planning
}

// Switching it off stops reading mail at once; what was found and is still waiting for an answer goes too.
export async function setMailOn(on: unknown) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  if (typeof on !== "boolean") throw new Error("Invalid setting");
  await sql`update users set mail_on = ${on} where id = ${session.user.id}`;
  if (!on) await sql`delete from mail_finds where user_id = ${session.user.id} and status = 'waiting'`;
}

// Inbox → Allow: asks Google for the Gmail permission again (reading and now sending), leaving "Read my email" as it is.
export async function allowGmail() {
  await signIn("google", { redirectTo: "/?inbox=1" }, withGmail);
}

export async function signOutNow() {
  (await cookies()).delete(LINK_COOKIE); // an unfinished Add mustn't attach the next sign-in to this Almanac
  await signOut({ redirectTo: "/" });
}

export async function setHiddenCalendars(ids: unknown) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  if (!Array.isArray(ids) || ids.length > 200 || !ids.every((i) => typeof i === "string" && i.length <= 300)) {
    throw new Error("Invalid calendar list");
  }
  await sql`update users set hidden_calendars = ${ids} where id = ${session.user.id}`;
}

// Events and to-do blocks ticked Done, as "calendarId:eventId": the views draw a line through them, the phone widget leaves them out.
export async function doneEventKeys() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  return [...(await doneKeys(session.user.id))];
}

// Almanac's own colour for a calendar ("#rrggbb"), or null for its Google colour again.
export async function setCalendarColor(id: unknown, color: unknown) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  if (typeof id !== "string" || id.length > 300 || (color !== null && (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)))) {
    throw new Error("Invalid colour");
  }
  if (color === null) await sql`update users set calendar_colors = calendar_colors - ${id}::text where id = ${session.user.id}`;
  else await sql`update users set calendar_colors = calendar_colors || jsonb_build_object(${id}::text, ${color}::text) where id = ${session.user.id}`;
}

// Calendars taken off the menu list (Almanac only; Google keeps them). The app hides them too.
export async function setRemovedCalendars(ids: unknown) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  if (!Array.isArray(ids) || ids.length > 200 || !ids.every((i) => typeof i === "string" && i.length <= 300)) {
    throw new Error("Invalid calendar list");
  }
  await sql`update users set removed_calendars = ${ids} where id = ${session.user.id}`;
}

// "ask": the auto-planner only suggests and you approve each change; "auto": it books and moves by itself.
export async function setPlanMode(mode: unknown) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  if (mode !== "ask" && mode !== "auto") throw new Error("Invalid mode");
  await sql`update users set plan_mode = ${mode} where id = ${session.user.id}`;
  // Switching to Automatic hands over what was waiting: the next run carries it out, so drop the old suggestions.
  if (mode === "auto") await sql`delete from plan_suggestions where user_id = ${session.user.id} and kind <> 'event'`; // morning fixes still wait for you
}

export type AlertStages = { remind: boolean; snooze: number; alarm: boolean };

export async function setAlertStages(s: unknown) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  const v = s as AlertStages;
  if (typeof v?.remind !== "boolean" || typeof v.alarm !== "boolean" || !SNOOZE_CHOICES.includes(v.snooze)) throw new Error("Invalid settings");
  await sql`
    update users set remind_popup = ${v.remind}, snooze_minutes = ${v.snooze}, alarm_at_start = ${v.alarm}
    where id = ${session.user.id}`;
}

// "About you" from the welcome pop-up or Settings. null = skipped: saved as blank so the pop-up doesn't come back.
export async function saveProfile(raw: unknown) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  const p = raw === null ? EMPTY_PROFILE : cleanProfile(raw);
  await sql`update users set profile = ${sql.json(p)} where id = ${session.user.id}`;
  return p;
}

// Settings → Account → Add: where to go to pick another Google account (see accounts.ts). app: from the Android app,
// which opens it in the phone's browser. gmail: also ask to read its Gmail.
export async function linkUrl(app: unknown, gmail?: unknown) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  return `/api/link?t=${encodeURIComponent(makeTicket(session.user.id, app === true, gmail === true))}`;
}

// Takes an added account out of Almanac (never the main one) and tells Google to forget Almanac's access to it. Its
// events stay in Google; they just stop showing here.
export async function removeAccount(id: unknown) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  if (typeof id !== "string" || id.length > 64) throw new Error("Invalid account");
  const [gone] = await sql<{ refresh_token_enc: string }[]>`
    delete from google_accounts where id = ${id}::uuid and user_id = ${session.user.id} and not is_main returning refresh_token_enc`;
  if (gone) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decrypt(gone.refresh_token_enc))}`, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {}); // best effort: it's already gone from Almanac, and the person can revoke it in their Google account
  }
}

// Settings → Account → "New events go to" (a calendar id). Google decides at write time whether it can be added to.
export async function setDefaultCalendar(id: unknown) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  if (typeof id !== "string" || !id || id.length > 300) throw new Error("Invalid calendar");
  await sql`update users set default_calendar = ${id} where id = ${session.user.id}`;
}
