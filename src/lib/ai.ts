import Anthropic from "@anthropic-ai/sdk";

// One question to the AI, answered as a JSON object: used by quick add and the priority ratings. Same provider
// as the assistant: Claude if ANTHROPIC_API_KEY is set, else the OpenAI-style AI_API_KEY (Groq by default).
// Returns the parsed object; throws if there's no key, the provider fails, or the answer isn't JSON.

export const hasAi = () => !!(process.env.ANTHROPIC_API_KEY || process.env.AI_API_KEY);

export async function askJson(system: string, user: string, timeoutMs = 30_000): Promise<unknown> {
  let reply: string;
  if (process.env.ANTHROPIC_API_KEY) {
    const res = await new Anthropic({ timeout: timeoutMs, maxRetries: 1 }).messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      system,
      messages: [{ role: "user", content: user }],
    });
    reply = res.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
  } else {
    if (!process.env.AI_API_KEY) throw new Error("No AI key");
    const base = (process.env.AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.AI_MODEL || "openai/gpt-oss-120b",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`AI: ${res.status} ${(await res.text()).slice(0, 300)}`);
    reply = (await res.json()).choices?.[0]?.message?.content ?? "";
  }
  return JSON.parse(reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1) || "null"); // some models wrap it in ``` fences
}
