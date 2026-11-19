// The Almanac mark on a 100-unit square: three cards stacked into one (mail, calendar, people: everything in one
// place), on ink, with today's dot on the front card. Used by the website's icons and the opening animation;
// scripts/android-icons.mjs and the Android status-bar icon draw the same shapes.
export const MARK = {
  ink: "#1d1b18",
  paper: "#f4f1ea",
  now: "#ff6a45",
  // Back to front; the back two fade so the front card reads first.
  cards: [
    { x: 30, y: 18, width: 40, height: 30, rx: 9, opacity: 0.3 },
    { x: 23, y: 28, width: 54, height: 34, rx: 10, opacity: 0.6 },
    { x: 16, y: 40, width: 68, height: 42, rx: 12, opacity: 1 },
  ],
  // Two lines of "text" on the front card, in ink.
  lines: [
    { x1: 27, y1: 59, x2: 58, y2: 59, opacity: 1 },
    { x1: 27, y1: 70, x2: 46, y2: 70, opacity: 0.45 },
  ],
  stroke: 5,
  dot: { cx: 72, cy: 53, r: 6 },
};

// The shapes, for an <svg viewBox="0 0 100 100">: a plain list of elements, since the icon renderer (next/og) only
// takes plain SVG elements inside <svg>. animate: class names the opening animation uses (globals.css).
export function markShapes(animate = false) {
  const { paper, ink, now, cards, lines, stroke, dot } = MARK;
  return [
    ...cards.map((c, i) => <rect key={i} {...c} fill={paper} className={animate ? `intro-card intro-card-${i + 1}` : undefined} />),
    ...lines.map((l, i) => (
      <line key={`l${i}`} {...l} stroke={ink} strokeWidth={stroke} strokeLinecap="round" className={animate ? "intro-line" : undefined} />
    )),
    <circle key="dot" {...dot} fill={now} className={animate ? "intro-dot" : undefined} />,
  ];
}
