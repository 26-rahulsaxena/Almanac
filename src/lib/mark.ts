// The Almanac mark on a 100-unit square: a paper "A" on ink, and the vermilion "now" line with its dot.
// Used by the website's icons and the opening animation; scripts/android-icons.mjs draws the same shapes.
export const MARK = {
  ink: "#1d1b18",
  paper: "#f4f1ea",
  now: "#ff6a45",
  a: "M22 70L44 22H56L78 70H66L60.8 58H39.2L34 70ZM50 33L56.5 48H43.5Z",
  line: { x: 12, y: 66, width: 76, height: 4.5 },
  dot: { cx: 12.5, cy: 69, r: 4.5 },
  // The drawing spans y 22-73.5, so it sits 4 units lower to look centred.
  shift: 4,
};
