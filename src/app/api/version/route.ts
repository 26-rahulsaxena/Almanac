// GET /api/version → the live version (see ALMANAC_BUILD in next.config.ts). Public; it's only a commit id.
export function GET() {
  return Response.json({ build: process.env.ALMANAC_BUILD }, { headers: { "Cache-Control": "no-store" } });
}
