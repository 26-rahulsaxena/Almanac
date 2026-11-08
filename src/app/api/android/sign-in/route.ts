import { cookies } from "next/headers";
import { signIn } from "@/auth";
import { CHALLENGE_COOKIE, HANDOFF_SECONDS, isToken } from "@/lib/app-handoff";

// GET /api/android/sign-in?c=<challenge>: opened by the Android app in the phone's browser. Remembers the app's
// challenge, then runs the normal Google sign-in, which comes back to /api/android/handoff.
export async function GET(req: Request) {
  const challenge = new URL(req.url).searchParams.get("c");
  if (!isToken(challenge)) return new Response("Open this from the Almanac app.", { status: 400 });
  (await cookies()).set(CHALLENGE_COOKIE, challenge, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/android",
    maxAge: 10 * 60 + HANDOFF_SECONDS, // time to get through Google's screens
  });
  await signIn("google", { redirectTo: "/api/android/handoff" });
}
