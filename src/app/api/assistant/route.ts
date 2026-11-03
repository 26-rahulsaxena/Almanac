import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { run, system, tools } from "@/lib/assistant";
import { ReauthError } from "@/lib/google";
import { me } from "@/lib/planner";
import { InvalidInput } from "@/lib/validate";

// The planning assistant's chat, using Claude. Chat history lives only in the browser tab; each question sends
// the visible chat plus what the tools read (event titles and times) to Anthropic.

const MODEL = "claude-opus-5-5";
const MAX_STEPS = 8; // tool rounds per question
const fail = (error: string, status = 400) => Response.json({ error }, { status });

type Turn ={ role: "user" | "assistant"; text: string };

// POST /api/assistant {messages: [{role, text}, ...]} → {reply, changed} (changed = the calendar or to-dos were updated).
export async function POST(req: Request) {
  const session = await auth();
  const u = await me(session?.user?.id);
  if (!u) return fail("signin", 401);
  if (!process.env.ANTHROPIC_API_KEY) return fail("nokey", 503);

  const b = await req.json().catch(() => null);
  const turns: Turn[] = Array.isArray(b?.messages) ? b.messages : [];
  if (
    !turns.length ||
    turns.length > 30 ||
    turns.at(-1)!.role !== "user" ||
    !turns.every((t) => (t?.role === "user" || t?.role === "assistant") && typeof t.text === "string" && t.text.trim() && t.text.length <= 4000)
  ) {
    return fail("Invalid request");
  }
  // shortcut: only the last 30 messages of the chat are sent; earlier ones are forgotten.
  const messages: Anthropic.Beta.BetaMessageParam[] = turns.slice(turns.findIndex((t) => t.role === "user")).map((t) => ({ role: t.role, content: t.text }));

  const now = new Date();
  const client = new Anthropic();
  let changed = false;
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default", // if Claude Opus declines, Anthropic retries on its default fallback model
        output_config: { effort: "low" },
        system: system(session?.user?.name ?? "the user", u, now),
        tools,
        messages,
      });
      if (res.stop_reason === "refusal") return Response.json({ reply: "Sorry, I can't help with that one.", changed });
      const uses = res.content.filter((c): c is Anthropic.Beta.BetaToolUseBlock => c.type === "tool_use");
      if (res.stop_reason !== "tool_use" || !uses.length) {
        const reply = res.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n").trim();
        return Response.json({ reply: reply || "Done.", changed });
      }
      messages.push({ role: "assistant", content: res.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const use of uses) {
        try {
          const r = await run(u, use.name, use.input as Record<string, unknown>, now);
          changed ||= !!r.changed;
          results.push({ type: "tool_result", tool_use_id: use.id, content: r.text });
        } catch (err) {
          if (!(err instanceof InvalidInput)) throw err;
          results.push({ type: "tool_result", tool_use_id: use.id, content: err.message, is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
    }
    return Response.json({ reply: "That took too many steps. Try asking in smaller parts.", changed });
  } catch (err) {
    if (err instanceof ReauthError) return fail("reauth", 401);
    if (err instanceof Anthropic.AuthenticationError) return fail("The assistant's Anthropic key isn't valid. Check ANTHROPIC_API_KEY.", 502);
    if (err instanceof Anthropic.RateLimitError) return fail("The assistant is busy. Try again in a minute.", 503);
    if (err instanceof Anthropic.APIError) {
      console.error("Assistant:", err.status, err.message);
      return fail(err.status === 400 && /credit/i.test(err.message) ? "Your Anthropic account is out of credit." : "The assistant couldn't answer. Try again.", 502);
    }
    console.error(err);
    return fail("The assistant couldn't answer. Try again.", 502);
  }
}
