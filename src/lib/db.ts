import postgres from "postgres";

// Reuse one connection pool across hot reloads in development.
const g = globalThis as unknown as { sql?: postgres.Sql };

// prepare: false is required by Supabase's transaction pooler (port 6543).
export const sql = (g.sql ??= postgres(process.env.DATABASE_URL!, { prepare: false }));
