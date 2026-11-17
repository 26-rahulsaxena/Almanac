import { cookies } from "next/headers";
import { signIn, withGmail } from "@/auth";
import { LINK_COOKIE, LINK_SECONDS, readTicket } from "@/lib/accounts";

const DONE: Record<string, [string, string]> = {
  added: ["Account added", "Its calendars are now in Almanac."],
  moved: ["Account added", "It had its own Almanac before; signing in with it now opens this one."],
  again: ["Done", "That account is connected again, with what you just allowed."],
  main: ["Nothing to add", "That's the account you sign in with."],
  error: ["That didn't work", "Go back to Almanac and try Add again."],
};

// GET /api/link?t=<ticket>: starts adding another Google account to the signed-in person's Almanac (see accounts.ts).
// GET /api/link?done=<result>: the end of it in the phone's browser, which then goes back to the Android app.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const done = DONE[params.get("done") ?? ""];
  if (done) {
    return new Response(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Almanac</title>
<body style="font-family:system-ui;padding:2rem;text-align:center"><h1>${done[0]}</h1><p>${done[1]}</p><p>Close this page to go back to Almanac.</p>`,
      { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
    );
  }

  const t = params.get("t");
  const ticket = readTicket(t);
  if (!ticket) return Response.redirect(new URL("/?account=error", req.url));
  (await cookies()).set(LINK_COOKIE, t!, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: LINK_SECONDS });
  // select_account: Google asks which account even when one is already signed in to the browser.
  await signIn("google", { redirectTo: "/" }, { prompt: "select_account consent", ...(ticket.gmail && withGmail) });
}
