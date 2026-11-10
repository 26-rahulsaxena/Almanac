"use server";
import { auth, signIn, signOut } from "@/auth";
import { sql } from "@/lib/db";
import { cleanProfile, EMPTY_PROFILE } from "@/lib/profile";
import { SNOOZE_CHOICES } from "@/lib/reminders";

export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/" });
}

export async function signOutNow() {
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
