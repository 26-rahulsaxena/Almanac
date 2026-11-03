import { auth, SHEETS_SCOPE } from "@/auth";
import { sql } from "@/lib/db";
import { ReauthError } from "@/lib/google";
import { me } from "@/lib/planner";
import { createSheet, settleOrphans, sheetIdFrom, syncSheet } from "@/lib/sheet-sync";
import { InvalidInput } from "@/lib/validate";

const fail = (error: string, status = 400) => Response.json({ error }, { status });

async function user() {
  const u = await me((await auth())?.user?.id);
  if (!u) return null;
  const [s] = await sql<{ email: string; sheet_id: string | null; sheet_name: string | null; sheet_synced_at: Date | null; scope: string | null }[]>`
    select u.email, u.sheet_id, u.sheet_name, u.sheet_synced_at, t.scope
    from users u left join google_tokens t on t.user_id = u.id where u.id = ${u.id}`;
  return { ...u, ...s };
}

// GET /api/sheet → the connected sheet, when it was last checked, whether sign-in allowed opening chosen files,
// and what the browser needs to show Google's file picker (all public values; the picker gets its own short-lived
// token that can only open files you pick).
export async function GET() {
  const u = await user();
  if (!u) return fail("signin", 401);
  const { AUTH_GOOGLE_ID, GOOGLE_PICKER_KEY, GOOGLE_PROJECT_NUMBER } = process.env;
  return Response.json({
    sheetId: u.sheet_id,
    name: u.sheet_name,
    syncedAt: u.sheet_synced_at,
    canRead: !!u.scope?.includes(SHEETS_SCOPE),
    picker: GOOGLE_PICKER_KEY && GOOGLE_PROJECT_NUMBER ? { key: GOOGLE_PICKER_KEY, appId: GOOGLE_PROJECT_NUMBER, clientId: AUTH_GOOGLE_ID, email: u.email } : null,
  });
}

// POST /api/sheet
//   {action: "connect", id}             → links the sheet chosen in the picker and syncs it
//   {action: "create"}                  → makes a new sheet in the template layout, links and syncs it
//   {action: "sync"}                    → syncs now
//   {action: "delete" | "keep", ids}    → for events whose row was removed: delete them, or keep them unlinked
export async function POST(req: Request) {
  const u = await user();
  if (!u) return fail("signin", 401);
  const b = await req.json().catch(() => null);
  try {
    switch (b?.action) {
      case "connect":
      case "create": {
        const id = b.action === "create" ? await createSheet(u) : typeof b.id === "string" ? sheetIdFrom(b.id) : null;
        if (!id) return fail("Choose a Google Sheet.");
        const result = await syncSheet(u, id); // fails before linking if the sheet can't be read
        await sql`update users set sheet_id = ${id} where id = ${u.id}`;
        return Response.json(result);
      }
      case "sync":
        if (!u.sheet_id) return fail("Choose a sheet first.");
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
  await sql`update users set sheet_id = null, sheet_name = null, sheet_version = null, sheet_synced_at = null where id = ${u.id}`;
  return Response.json({ sheetId: null });
}
