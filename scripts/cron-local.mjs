// Local stand-in for the production scheduler: calls /api/cron every minute (or once with --once).
// Run: npm run cron:local
import { readFileSync } from "node:fs";

const secret = readFileSync(new URL("../.env.local", import.meta.url), "utf8").match(/^CRON_SECRET=(.+)$/m)?.[1].trim();
if (!secret) throw new Error("CRON_SECRET missing from .env.local");

let running = false;
async function tick() {
  if (running) return console.log(new Date().toLocaleTimeString(), "previous run still going, skipped");
  running = true;
  try {
    const r = await fetch("http://localhost:3000/api/cron", { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(110_000) });
    console.log(new Date().toLocaleTimeString(), r.status, await r.text());
  } catch (err) {
    // e.g. the app is restarting or the computer just woke up: try again next minute instead of stopping
    console.log(new Date().toLocaleTimeString(), "failed:", err.cause?.code ?? err.name ?? err.message);
  } finally {
    running = false;
  }
}

await tick();
if (!process.argv.includes("--once")) setInterval(tick, 60_000);
