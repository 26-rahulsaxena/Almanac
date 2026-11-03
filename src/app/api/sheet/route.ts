import { auth, SHEETS_SCOPE } from "@/auth";
import { sql } from "@/lib/db";
import { ReauthError } from "@/lib/google";
import { me } from "@/lib/planner";
import { settleOrphans, sheetIdFrom, syncSheet } from "@/lib/sheet-sync";
import { InvalidInput } from "@/lib/validate";

const fail = (error: string, status = 400) => Response.json({ error }, { status });

async function user() {
  const u = await me((await auth())?.user?.id);
  if (!u) return null;
  const [s] = await sql<{ sheet_id: string | null; sheet_synced_at: Date | null; scope: string | null }[]>`
    select u.sheet_id, u.sheet_synced_at, t.scope from users u left join google_tokens t on t.user_id = u.id where u.id = ${u.id}`;
  return { ...u, ...s };
}

// GET /api/sheet → which sheet is connected, when it last synced, and whether sign-in allowed reading Sheets.
export async function GET() {
  const u = await user();
  if (!u) return fail("signin", 401);
  return Response.json({ sheetId: u.sheet_id, syncedAt: u.sheet_synced_at, canRead: !!u.scope?.includes(SHEETS_SCOPE) });
}

// POST /api/sheet
//   {action: "connect", url}            → links the sheet and syncs it
//   {action: "sync"}                    → syncs now
//   {action: "delete" | "keep", ids}    → for events whose row was removed: delete them, or keep them unlinked
export async function POST(req: Request) {
  const u = await user();
  if (!u) return fail("signin", 401);
  const b = await req.json().catch(() => null);
  try {
    switch (b?.action) {
      case "connect": {
        const id = typeof b.url === "string" ? sheetIdFrom(b.url) : null;
        if (!id) return fail("Paste the sheet's link (it looks like docs.google.com/spreadsheets/d/…).");
        const result = await syncSheet(u, id); // fails before saving if the sheet can't be read
        await sql`update users set sheet_id = ${id} where id = ${u.id}`;
        return Response.json(result);
      }
      case "sync":
        if (!u.sheet_id) return fail("Connect a sheet first.");
        return Response.json(await syncSheet(u, u.sheet_id));
      case "delete":
      case "keep": {
        const ids: unknown = b.ids;
        if (!u.sheet_id || !Array.isArray(ids) || ids.length > 500 || !ids.every((i) => typeof i === "string" && /^[\w-]{1,1024}$/.test(i))) {
          return fail("Invalid request");
        }
        await settleOrphans(u, u.sheet_id, ids, b.action);
        return Response.json(await syncSheet(u, u.sheet_id));
      }
    }
    return fail("Invalid request");
  } catch (err) {
    if (err instanceof InvalidInput) return fail(err.message);
    if (err instanceof ReauthError) return fail("reauth", 401);
    console.error("Sheet sync:", err);
    return fail("Couldn't sync with the sheet. Try again.", 502);
  }
}

// DELETE /api/sheet → stops syncing. Events already made from the sheet stay on the calendar.
export async function DELETE() {
  const u = await user();
  if (!u) return fail("signin", 401);
  await sql`update users set sheet_id = null, sheet_synced_at = null where id = ${u.id}`;
  return Response.json({ sheetId: null });
}
