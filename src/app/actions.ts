"use server";
import { auth, signIn, signOut } from "@/auth";
import { sql } from "@/lib/db";

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
