import { ImageResponse } from "next/og";
import { MARK } from "@/lib/mark";

// The small icon in the phone's status bar for website notifications (sw.js "badge"). Android draws it in one
// colour from its transparency, so it's the mark in white on nothing: the back cards faint, the front card solid
// with its lines and dot cut out (like the Android app's ic_stat_almanac).
const rr = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;

export function GET() {
  const { cards, lines, stroke: s, dot } = MARK;
  const [back, middle, front] = cards.map((c) => rr(c.x, c.y, c.width, c.height, c.rx));
  const holes = lines.map((l) => rr(l.x1 - s / 2, l.y1 - s / 2, l.x2 - l.x1 + s, s, s / 2)).join("");
  const { cx, cy, r } = dot;
  const dotHole = `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`;
  return new ImageResponse(
    (
      <svg width={96} height={96} viewBox="0 0 100 100">
        <path d={back} fill="#fff" fillOpacity={0.3} />
        <path d={middle} fill="#fff" fillOpacity={0.6} />
        <path d={front + holes + dotHole} fill="#fff" fillRule="evenodd" />
      </svg>
    ),
    { width: 96, height: 96 },
  );
}
