// Local stand-in for the production scheduler: calls /api/cron every minute (or once with --once).
// Run: npm run cron:local
import { readFileSync } from "node:fs";

const secret = readFileSync(new URL("../.env.local", import.meta.url), "utf8").match(/^CRON_SECRET=(.+)$/m)?.[1].trim();
if (!secret) throw new Error("CRON_SECRET missing from .env.local");

async function tick() {
  const r = await fetch("http://localhost:3000/api/cron", { headers: { authorization: `Bearer ${secret}` } });
  console.log(new Date().toLocaleTimeString(), r.status, await r.text());
}

await tick();
if (!process.argv.includes("--once")) setInterval(tick, 60_000);
