import { after } from "next/server";
import postgres from "postgres";

// DATABASE_URL points at Supabase's pooler in session mode (port 5432). Transaction mode (6543) hung now and then:
// postgres.js asks the server to describe a query before sending its values, and through that pooler the
// description sometimes never came back, leaving both sides waiting (pg_stat_activity: active / ClientRead).
// Session mode holds one server connection per open app connection, and the free plan's pooler allows only 15 in
// all. On Vercel every running copy of the app has its own pool, so each keeps 1 (2 locally) and lets go after 5 s
// idle. Vercel pauses a copy once its response is sent, and a paused copy's timers stop, so it would keep its
// connection; after deploys the paused copies held all 15. So each request that used the database keeps its copy
// awake (after(), Vercel's waitUntil) until that connection has closed. Vercel's own attachDatabasePool does the same
// but doesn't support postgres.js.
// shortcut: still 15 in all; under heavy use raise "Pool size" in Supabase (Database > Connection pooling).
// Closing idle ones also means none are left dead after the computer sleeps or the network drops;
// connecting gives up after 10 s instead of waiting forever.
const ON_VERCEL = !!process.env.VERCEL;
const open = () =>
  postgres(process.env.DATABASE_URL!, {
    prepare: false,
    max: ON_VERCEL ? 1 : 2,
    idle_timeout: 5,
    connect_timeout: 10,
    onclose: () => {
      connected = false;
      for (const done of waiting.splice(0)) done();
    },
  });

// On Vercel: whether this copy's one connection may be open, and requests waiting for it to close.
let connected = false;
const waiting: (() => void)[] = [];
const AWAKE_MAX_MS = 20_000; // never keep a copy awake longer than this, whatever happens

function stayAwakeUntilClosed() {
  if (!ON_VERCEL) return;
  connected = true;
  try {
    after(
      () =>
        new Promise<void>((done) => {
          if (!connected) return done();
          waiting.push(done);
          setTimeout(done, AWAKE_MAX_MS);
        }),
    );
  } catch {
    // Not inside a request (a script or a test): there's no copy to keep awake.
  }
}

// One pool, reused across hot reloads in development, and replaceable when it gets stuck (see healthCheck).
const g = globalThis as unknown as { sql?: postgres.Sql };
const pool = () => (g.sql ??= open());

// `sql` always talks to the current pool, so swapping it out reaches every module that imported `sql`.
export const sql = new Proxy(function () {} as unknown as postgres.Sql, {
  apply: (_target, _this, args) => {
    stayAwakeUntilClosed();
    return (pool() as unknown as (...a: unknown[]) => unknown)(...args);
  },
  get: (_target, key) => Reflect.get(pool(), key),
});

// Run by the minute job. A query once stayed half-sent between the app and the pooler, and everything queued
// behind it waited forever; if a trivial query gets no answer in 10 s, start over with fresh connections.
export async function healthCheck() {
  stayAwakeUntilClosed();
  const ok = await Promise.race([pool()`select 1`.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 10_000))]).catch(() => false);
  if (ok) return true;
  const stuck = g.sql;
  g.sql = open();
  stuck?.end({ timeout: 0 }).catch(() => {});
  console.error("Database connections were stuck; opened fresh ones.");
  return false;
}
