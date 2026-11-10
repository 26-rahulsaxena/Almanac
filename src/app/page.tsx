import { Suspense } from "react";
import { connection } from "next/server";
import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { listCalendars } from "@/lib/calendar";
import { ReauthError } from "@/lib/google";
import { Landing } from "@/components/landing";
import { CalendarApp } from "@/components/calendar-app";
import { cleanProfile, EMPTY_PROFILE, type Profile } from "@/lib/profile";

// Who's signed in is only known per request, so it streams in behind Suspense (Next 16 cache components).
export default function Page(props: PageProps<"/">) {
  return (
    <Suspense>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ searchParams }: PageProps<"/">) {
  await connection(); // auth() uses crypto randomness, which must not run during prerender
  const session = await auth();
  if (!session?.user?.id) {
    const { error } = await searchParams;
    return <Landing error={typeof error === "string" ? error : undefined} />;
  }

  const calendars = await listCalendars(session.user.id).catch((err) => {
    if (err instanceof ReauthError) return null;
    throw err;
  });
  if (!calendars) return <Landing error="Reauth" />;

  const [user] = await sql<{ hidden_calendars: string[]; calendar_colors: Record<string, string>; removed_calendars: string[]; remind_popup: boolean; snooze_minutes: number; alarm_at_start: boolean; plan_mode: "ask" | "auto"; profile: Profile | null }[]>`
    select hidden_calendars, calendar_colors, removed_calendars, remind_popup, snooze_minutes, alarm_at_start, plan_mode, profile from users where id = ${session.user.id}`;
  const stages = { remind: user?.remind_popup ?? true, snooze: user?.snooze_minutes ?? 5, alarm: user?.alarm_at_start ?? true };
  return (
    <CalendarApp name={session.user.name ?? ""} email={session.user.email ?? ""} calendars={calendars} hidden={user?.hidden_calendars ?? []} colors={user?.calendar_colors ?? {}} removed={user?.removed_calendars ?? []} stages={stages} planMode={user?.plan_mode ?? "ask"} profile={!user ? EMPTY_PROFILE : user.profile && cleanProfile(user.profile)} />
  );
}
