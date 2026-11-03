"use server";
import { auth, signIn, signOut } from "@/auth";
import { sql } from "@/lib/db";
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
