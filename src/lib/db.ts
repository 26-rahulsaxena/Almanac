import postgres from "postgres";

// Reuse one connection pool across hot reloads in development.
const g = globalThis as unknown as { sql?: postgres.Sql };

// prepare: false is required by Supabase's transaction pooler (port 6543).
// Idle connections close after 20 s, so none are left dead after the computer sleeps or the network drops
// (a dead one made every request hang for minutes); connecting gives up after 10 s instead of waiting forever.
export const sql = (g.sql ??= postgres(process.env.DATABASE_URL!, { prepare: false, idle_timeout: 20, connect_timeout: 10 }));
