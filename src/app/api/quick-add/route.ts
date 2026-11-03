import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { me } from "@/lib/planner";
import { quickAddPrompt, toProposal } from "@/lib/quick-add";
import { InvalidInput } from "@/lib/validate";

// POST /api/quick-add {text} → a Proposal for the person to confirm. Saves nothing. Uses the same AI provider as
// the assistant (Claude if ANTHROPIC_API_KEY is set, else the OpenAI-style AI_API_KEY); only the line is sent.
const fail = (error: string, status = 400) => Response.json({ error }, { status });

async function ask(sys: string, line: string): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY) {
    const res = await new Anthropic({ timeout: 30_000, maxRetries: 1 }).messages.create({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      system: sys,
      messages: [{ role: "user", content: line }],
    });
    return res.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
  }
  const base = (process.env.AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.AI_MODEL || "openai/gpt-oss-120b",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: line },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Quick add: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).choices?.[0]?.message?.content ?? "";
}

export async function POST(req: Request) {
  const u = await me((await auth())?.user?.id);
  if (!u) return fail("signin", 401);
  if (!process.env.ANTHROPIC_API_KEY && !process.env.AI_API_KEY) return fail("Quick add needs the assistant's AI key.", 503);
  const b = await req.json().catch(() => null);
  const line = typeof b?.text === "string" ? b.text.trim() : "";
  if (!line || line.length > 300) return fail("Type or say what to add (300 characters at most).");
  const now = new Date();
  try {
    const reply = await ask(quickAddPrompt(now, u.timezone), line);
    const json = reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1); // some models wrap it in ``` fences
    return Response.json(toProposal(JSON.parse(json || "null"), now, u.timezone));
  } catch (err) {
    if (err instanceof InvalidInput) return fail(err.message);
    console.error(err);
    return fail(err instanceof SyntaxError ? "Couldn't make sense of that. Try saying it another way." : "Quick add isn't working right now. Try again.", 502);
  }
}
