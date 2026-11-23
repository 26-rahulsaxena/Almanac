// GET /api/weather → the weather where the viewer is now, for Home's scene: { kind } or { kind: null }.
// Where: the approximate (city-level) spot Vercel works out from the request's IP, so the browser asks no
// permission. Only those rounded coordinates go to Open-Meteo (free, no key). Public; it says nothing about the user.
import { weatherKind } from "@/lib/weather";

export async function GET(req: Request) {
  const lat = Number(req.headers.get("x-vercel-ip-latitude"));
  const lon = Number(req.headers.get("x-vercel-ip-longitude"));
  const none = Response.json({ kind: null }, { headers: { "Cache-Control": "no-store" } });
  if (!req.headers.get("x-vercel-ip-latitude") || !Number.isFinite(lat) || !Number.isFinite(lon)) return none; // local dev
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(1)}&longitude=${lon.toFixed(1)}&current=weather_code,cloud_cover`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000), cache: "no-store" });
    if (!res.ok) return none;
    const { current: c } = await res.json();
    if (typeof c?.weather_code !== "number") return none;
    return Response.json(
      { kind: weatherKind(c.weather_code, c.cloud_cover ?? 0) },
      // The viewer's browser keeps it for 20 minutes; weather doesn't change faster than that.
      { headers: { "Cache-Control": "private, max-age=1200" } },
    );
  } catch {
    return none;
  }
}
