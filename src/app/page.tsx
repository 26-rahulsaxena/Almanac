import { Suspense } from "react";
import { connection } from "next/server";
import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { Landing } from "@/components/landing";
import { Home } from "@/components/home";

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

  const [token] = await sql<{ scope: string | null }[]>`
    select scope from google_tokens where user_id = ${session.user.id}`;
  return (
    <Home
      name={session.user.name ?? "there"}
      email={session.user.email ?? ""}
      calendarAccess={!!token?.scope?.includes("calendar.events")}
    />
  );
}
