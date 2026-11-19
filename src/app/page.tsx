import { Suspense } from "react";
import { connection } from "next/server";
import { auth, MAIL_READ } from "@/auth";
import { sql } from "@/lib/db";
import { listCalendars } from "@/lib/calendar";
import { listAccounts } from "@/lib/accounts";
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

  const [user] = await sql<{ hidden_calendars: string[]; calendar_colors: Record<string, string>; removed_calendars: string[]; remind_popup: boolean; snooze_minutes: number; alarm_at_start: boolean; plan_mode: "ask" | "auto"; profile: Profile | null; mail_on: boolean; default_calendar: string | null; gmail: boolean }[]>`
    select hidden_calendars, calendar_colors, removed_calendars, remind_popup, snooze_minutes, alarm_at_start, plan_mode, profile, mail_on, default_calendar,
      exists (select 1 from google_accounts t where t.user_id = users.id and t.broken_at is null and t.scope like ${MAIL_READ}) as gmail
    from users where id = ${session.user.id}`;
  const accounts = await listAccounts(session.user.id);
  // Only the calendars of accounts switched on in the ☰ menu.
  const on = new Set(accounts.filter((a) => a.active).map((a) => a.id));
  const shownCalendars = calendars.filter((c) => on.has(c.accountId));
  const stages = { remind: user?.remind_popup ?? true, snooze: user?.snooze_minutes ?? 5, alarm: user?.alarm_at_start ?? true };
  return (
    <CalendarApp name={session.user.name ?? ""} email={session.user.email ?? ""} accounts={accounts} calendars={shownCalendars} defaultCalendar={user?.default_calendar ?? null} hidden={user?.hidden_calendars ?? []} colors={user?.calendar_colors ?? {}} removed={user?.removed_calendars ?? []} stages={stages} planMode={user?.plan_mode ?? "ask"} mail={{ gmail: !!user?.gmail, on: !!user?.mail_on }} profile={!user ? EMPTY_PROFILE : user.profile && cleanProfile(user.profile)} />
  );
}
