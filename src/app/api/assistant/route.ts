import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { run, system, tools } from "@/lib/assistant";
import { ReauthError } from "@/lib/google";
import { me } from "@/lib/planner";
import { InvalidInput } from "@/lib/validate";

// The planning assistant's chat. Uses Claude when ANTHROPIC_API_KEY is set, otherwise any OpenAI-style provider
// set by AI_API_KEY (+ AI_BASE_URL, AI_MODEL): Groq's free tier by default, or Google Gemini.
// Chat history lives only in the browser tab; each question sends the visible chat plus what the tools read
// (event titles and times) to that provider.

const CLAUDE_MODEL = "claude-opus-5-5";
const MAX_STEPS = 8; // tool rounds per question
const fail = (error: string, status = 400) => Response.json({ error }, { status });

type Turn = { role: "user" | "assistant"; text: string };
// Runs one tool call for the model: its text result, or an error message the model can correct itself from.
type Act = (name: string, input: unknown) => Promise<{ text: string; isError?: boolean }>;

// A provider problem the user can act on, shown as is.
class ProviderError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

async function askClaude(sys: string, turns: Turn[], act: Act) {
  const client = new Anthropic();
  const messages: Anthropic.Beta.BetaMessageParam[] = turns.map((t) => ({ role: t.role, content: t.text }));
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await client.beta.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default", // if Claude Opus declines, Anthropic retries on its default fallback model
        output_config: { effort: "low" },
        system: sys,
        tools,
        messages,
      });
      if (res.stop_reason === "refusal") return "Sorry, I can't help with that one.";
      const uses = res.content.filter((c): c is Anthropic.Beta.BetaToolUseBlock => c.type === "tool_use");
      if (res.stop_reason !== "tool_use" || !uses.length) return res.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n");
      messages.push({ role: "assistant", content: res.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const use of uses) {
        const r = await act(use.name, use.input);
        results.push({ type: "tool_result", tool_use_id: use.id, content: r.text, is_error: r.isError });
      }
      messages.push({ role: "user", content: results });
    }
    return null;
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new ProviderError("The assistant's Anthropic key isn't valid. Check ANTHROPIC_API_KEY.");
    if (err instanceof Anthropic.RateLimitError) throw new ProviderError("The assistant is busy. Try again in a minute.", 503);
    if (err instanceof Anthropic.APIError) {
      console.error("Assistant:", err.status, err.message);
      throw new ProviderError(err.status === 400 && /credit/i.test(err.message) ? "Your Anthropic account is out of credit." : "The assistant couldn't answer. Try again.");
    }
    throw err;
  }
}

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type ChatMessage = { role: string; content?: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };
const openAiTools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));

// The OpenAI chat-completions format, which Groq, Google Gemini and most free providers accept.
async function askOpenAiStyle(sys: string, turns: Turn[], act: Act) {
  const base = (process.env.AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const model = process.env.AI_MODEL || "openai/gpt-oss-120b";
  const messages: ChatMessage[] = [{ role: "system", content: sys }, ...turns.map((t) => ({ role: t.role, content: t.text }))];
  for (let step = 0; step < MAX_STEPS; step++) {
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, tools: openAiTools, tool_choice: "auto" }),
      });
      // Free tiers cap tokens per minute; when the wait is short, wait it out instead of failing.
      const wait = Number(res.headers.get("retry-after"));
      if (res.status !== 429 || attempt === 3 || !(wait <= 20)) break;
      await new Promise((r) => setTimeout(r, (wait || 1) * 1000 + 300));
    }
    if (!res.ok) {
      console.error("Assistant:", res.status, (await res.text()).slice(0, 500));
      if (res.status === 401 || res.status === 403) throw new ProviderError("The assistant's key isn't valid. Check AI_API_KEY in .env.local.");
      if (res.status === 429) throw new ProviderError("The free assistant has hit its limit for now. Wait a minute (or until tomorrow) and try again.", 503);
      throw new ProviderError("The assistant couldn't answer. Try again.");
    }
    const msg: ChatMessage | undefined = (await res.json()).choices?.[0]?.message;
    if (!msg) throw new ProviderError("The assistant couldn't answer. Try again.");
    if (!msg.tool_calls?.length) return msg.content ?? "";
    // Tool calls go back unchanged: Gemini attaches a signature to them that it checks on the next round.
    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
    for (const call of msg.tool_calls) {
      let input: unknown;
      try {
        input = JSON.parse(call.function.arguments || "{}");
      } catch {
        input = null;
      }
      const r = input && typeof input === "object" ? await act(call.function.name, input) : { text: "Arguments weren't valid JSON. Try again." };
      messages.push({ role: "tool", tool_call_id: call.id, content: r.text });
    }
  }
  return null;
}

// POST /api/assistant {messages: [{role, text}, ...]} → {reply, changed} (changed = the calendar or to-dos were updated).
export async function POST(req: Request) {
  const session = await auth();
  const u = await me(session?.user?.id);
  if (!u) return fail("signin", 401);
  const claude = !!process.env.ANTHROPIC_API_KEY;
  if (!claude && !process.env.AI_API_KEY) return fail("nokey", 503);

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

  const now = new Date();
  let changed = false;
  const act: Act = async (name, input) => {
    try {
      const r = await run(u, name, input as Record<string, unknown>, now);
      changed ||= !!r.changed;
      return { text: r.text };
    } catch (err) {
      if (err instanceof InvalidInput) return { text: err.message, isError: true };
      throw err;
    }
  };

  try {
    // shortcut: only the last 30 messages of the chat are sent; earlier ones are forgotten.
    const history = turns.slice(turns.findIndex((t) => t.role === "user")).map((t) => ({ role: t.role, text: t.text }));
    const sys = system(session?.user?.name ?? "the user", u, now);
    const reply = await (claude ? askClaude : askOpenAiStyle)(sys, history, act);
    // The chat shows plain text, so drop **bold** marks some models add anyway.
    const text = reply === null ? "That took too many steps. Try asking in smaller parts." : reply.replace(/\*\*(.+?)\*\*/g, "$1").trim() || "Done.";
    return Response.json({ reply: text, changed });
  } catch (err) {
    if (err instanceof ReauthError) return fail("reauth", 401);
    if (err instanceof ProviderError) {
      const done = changed ? " Part of it was already done: check your calendar and to-do list." : "";
      return Response.json({ error: err.message + done, changed }, { status: err.status });
    }
    console.error(err);
    return fail("The assistant couldn't answer. Try again.", 502);
  }
}
