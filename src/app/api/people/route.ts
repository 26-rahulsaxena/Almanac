import { auth } from "@/auth";
import { ReauthError } from "@/lib/google";
import { waitingFinds } from "@/lib/mail";
import { getPerson, hidePerson, listPeople, meetingsWith, syncFirst } from "@/lib/people";
import { me } from "@/lib/planner";

const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;
const fail = (error: string, status = 400) => Response.json({ error }, { status });
const parseEmail = (v: unknown) => (typeof v === "string" && v.length <= 320 && EMAIL.test(v.trim()) ? v.trim().toLowerCase() : null);

// GET /api/people → everyone you email with, latest first (an inbox never looked at is looked at first).
// GET /api/people?email=<address> → {person, meetings, finds}: them, your meetings with them over the past and next
// year, and what was found in their emails that's waiting for Add.
export async function GET(req: Request) {
  const u = await me((await auth())?.user?.id);
  if (!u) return fail("signin", 401);
  const raw = new URL(req.url).searchParams.get("email");
  try {
    if (raw === null) {
      await syncFirst(u.id).catch((err) => console.error("Gathering people failed:", err)); // the list as it is, then
      return Response.json(await listPeople(u.id));
    }
    const email = parseEmail(raw);
    if (!email) return fail("Invalid address");
    const [person, meetings, finds] = await Promise.all([
      getPerson(u.id, email),
      meetingsWith(u.id, email, u.hidden_calendars).catch((err) => {
        if (err instanceof ReauthError) throw err;
        console.error(err);
        return null; // the rest still shows; the page says meetings couldn't be loaded
      }),
      waitingFinds(u.id),
    ]);
    return Response.json({ person, meetings, finds: finds.filter((f) => f.sender_email === email) });
  } catch (err) {
    if (err instanceof ReauthError) return fail("reauth", 401);
    console.error(err);
    return fail("Couldn't load people. Try again.", 502);
  }
}

// POST /api/people {email, action: "hide"} → takes them off the list for good (not counted again).
export async function POST(req: Request) {
  const u = await me((await auth())?.user?.id);
  if (!u) return fail("signin", 401);
  const b = await req.json().catch(() => null);
  const email = parseEmail(b?.email);
  if (!email || b?.action !== "hide") return fail("Invalid request");
  await hidePerson(u.id, email);
  return Response.json({ ok: true });
}
