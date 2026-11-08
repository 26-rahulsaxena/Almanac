// Makes the Android app's icon files from one drawing of the Almanac mark (ink square, paper "A", vermilion
// "now" line). Run with `node scripts/android-icons.mjs` after changing the drawing.
import sharp from "sharp";

const INK = "#1d1b18", PAPER = "#f4f1ea", NOW = "#ff6a45";
// The mark on a 100-unit square (same proportions as Mark in src/app/icon.tsx).
export const A_PATH = "M22 70L44 22H56L78 70H66L60.8 58H39.2L34 70ZM50 33L56.5 48H43.5Z";
export const LINE = { x: 12, y: 66, w: 76, h: 4.5 };
export const DOT = { cx: 12.5, cy: 69, r: 4.5 };
// The drawing spans y 22-73.5, so it moves down a little to sit in the optical centre.
const mark = (scale, off) => `<g transform="translate(${off} ${off + 4 * scale}) scale(${scale})">
  <path d="${A_PATH}" fill="${PAPER}" fill-rule="evenodd"/>
  <rect x="${LINE.x}" y="${LINE.y}" width="${LINE.w}" height="${LINE.h}" rx="2.25" fill="${NOW}"/>
  <circle cx="${DOT.cx}" cy="${DOT.cy}" r="${DOT.r}" fill="${NOW}"/></g>`;
const svg = (body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">${body}</svg>`);

const res = "android/app/src/main/res";
const dpi = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
// Adaptive icon foreground: the mark inside the 66-unit safe zone, on transparent (the background is a colour).
const fg = svg(mark(0.66, 21));
// Older phones: the whole icon, square with rounded corners and round.
const square = svg(`<rect width="108" height="108" rx="20" fill="${INK}"/>${mark(0.8, 10.8)}`);
const round = svg(`<circle cx="54" cy="54" r="54" fill="${INK}"/>${mark(0.72, 15.1)}`);

for (const [d, k] of Object.entries(dpi)) {
  await sharp(fg, { density: 72 * k * 1.5 }).resize(108 * k, 108 * k).png().toFile(`${res}/mipmap-${d}/ic_launcher_foreground.png`);
  await sharp(square, { density: 72 * k }).resize(48 * k, 48 * k).png().toFile(`${res}/mipmap-${d}/ic_launcher.png`);
  await sharp(round, { density: 72 * k }).resize(48 * k, 48 * k).png().toFile(`${res}/mipmap-${d}/ic_launcher_round.png`);
}
if (process.argv[2]) await sharp(square, { density: 400 }).resize(512, 512).png().toFile(process.argv[2]); // optional preview
console.log("Icons written");
