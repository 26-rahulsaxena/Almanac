import { auth } from "@/auth";
import { askJson, hasAi } from "@/lib/ai";
import { me } from "@/lib/planner";
import { quickAddPrompt, toProposal } from "@/lib/quick-add";
import { InvalidInput } from "@/lib/validate";

// POST /api/quick-add {text} → a Proposal for the person to confirm. Saves nothing; only the line is sent to the AI.
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function POST(req: Request) {
  const u = await me((await auth())?.user?.id);
  if (!u) return fail("signin", 401);
  if (!hasAi()) return fail("Quick add needs the assistant's AI key.", 503);
  const b = await req.json().catch(() => null);
  const line = typeof b?.text === "string" ? b.text.trim() : "";
  if (!line || line.length > 300) return fail("Type or say what to add (300 characters at most).");
  const now = new Date();
  try {
    return Response.json(toProposal(await askJson(quickAddPrompt(now, u.timezone), line), now, u.timezone));
  } catch (err) {
    if (err instanceof InvalidInput) return fail(err.message);
    console.error(err);
    return fail(err instanceof SyntaxError ? "Couldn't make sense of that. Try saying it another way." : "Quick add isn't working right now. Try again.", 502);
  }
}
