import { Suspense } from "react";
import { connection } from "next/server";
import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { listCalendars } from "@/lib/calendar";
import { ReauthError } from "@/lib/google";
import { Landing } from "@/components/landing";
import { CalendarApp } from "@/components/calendar-app";

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

  const [user] = await sql<{ hidden_calendars: string[] }[]>`
    select hidden_calendars from users where id = ${session.user.id}`;
  return <CalendarApp name={session.user.name ?? ""} calendars={calendars} hidden={user?.hidden_calendars ?? []} />;
}
