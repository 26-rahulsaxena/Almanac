import postgres from "postgres";

// DATABASE_URL points at Supabase's pooler in session mode (port 5432). Transaction mode (6543) hung now and then:
// postgres.js asks the server to describe a query before sending its values, and through that pooler the
// description sometimes never came back, leaving both sides waiting (pg_stat_activity: active / ClientRead).
// shortcut: session mode holds one server connection per open app connection (pooler limit ~15 on the free plan); fine
// for one server, revisit before running on serverless with many instances.
// Idle connections close after 20 s, so none are left dead after the computer sleeps or the network drops;
// connecting gives up after 10 s instead of waiting forever.
const open = () => postgres(process.env.DATABASE_URL!, { prepare: false, idle_timeout: 20, connect_timeout: 10 });

// One pool, reused across hot reloads in development, and replaceable when it gets stuck (see healthCheck).
const g = globalThis as unknown as { sql?: postgres.Sql };
const pool = () => (g.sql ??= open());

// `sql` always talks to the current pool, so swapping it out reaches every module that imported `sql`.
export const sql = new Proxy(function () {} as unknown as postgres.Sql, {
  apply: (_target, _this, args) => (pool() as unknown as (...a: unknown[]) => unknown)(...args),
  get: (_target, key) => Reflect.get(pool(), key),
});

// Run by the minute job. A query once stayed half-sent between the app and the pooler, and everything queued
// behind it waited forever; if a trivial query gets no answer in 10 s, start over with fresh connections.
export async function healthCheck() {
  const ok = await Promise.race([pool()`select 1`.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 10_000))]).catch(() => false);
  if (ok) return true;
  const stuck = g.sql;
  g.sql = open();
  stuck?.end({ timeout: 0 }).catch(() => {});
  console.error("Database connections were stuck; opened fresh ones.");
  return false;
}
