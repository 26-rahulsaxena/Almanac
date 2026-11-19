// Makes the Android app's icon files from one drawing of the Almanac mark (ink square, three paper cards stacked
// into one, today's vermilion dot), and the website's favicon.ico. Run with `node scripts/android-icons.mjs` after
// changing the drawing.
import { writeFileSync } from "node:fs";
import sharp from "sharp";

const INK = "#1d1b18", PAPER = "#f4f1ea", NOW = "#ff6a45";
// The mark on a 100-unit square (same shapes as MARK in src/lib/mark.tsx); it spans x 16-84, y 18-82, so it's centred.
export const CARDS = [
  { x: 30, y: 18, w: 40, h: 30, r: 9, o: 0.3 },
  { x: 23, y: 28, w: 54, h: 34, r: 10, o: 0.6 },
  { x: 16, y: 40, w: 68, h: 42, r: 12, o: 1 },
];
export const LINES = [
  { x1: 27, y1: 59, x2: 58, y2: 59, o: 1 },
  { x1: 27, y1: 70, x2: 46, y2: 70, o: 0.45 },
];
export const DOT = { cx: 72, cy: 53, r: 6 };
const drawing = `${CARDS.map((c) => `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="${c.r}" fill="${PAPER}" opacity="${c.o}"/>`).join("")}
  ${LINES.map((l) => `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="${INK}" stroke-width="5" stroke-linecap="round" opacity="${l.o}"/>`).join("")}
  <circle cx="${DOT.cx}" cy="${DOT.cy}" r="${DOT.r}" fill="${NOW}"/>`;
const mark = (scale, off) => `<g transform="translate(${off} ${off}) scale(${scale})">${drawing}</g>`;
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
// favicon.ico: 16, 32 and 48 px PNGs in one .ico (the format allows PNG entries).
const pngs = await Promise.all([16, 32, 48].map((n) => sharp(square, { density: 400 }).resize(n, n).png().toBuffer()));
const head = Buffer.alloc(6 + 16 * pngs.length);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(pngs.length, 4);
let at = head.length;
pngs.forEach((p, i) => {
  const n = [16, 32, 48][i], e = 6 + 16 * i;
  head.writeUInt8(n, e);
  head.writeUInt8(n, e + 1);
  head.writeUInt16LE(1, e + 4);
  head.writeUInt16LE(32, e + 6);
  head.writeUInt32LE(p.length, e + 8);
  head.writeUInt32LE(at, e + 12);
  at += p.length;
});
writeFileSync("src/app/favicon.ico", Buffer.concat([head, ...pngs]));
if (process.argv[2]) await sharp(square, { density: 400 }).resize(512, 512).png().toFile(process.argv[2]); // optional preview
console.log("Icons and favicon written");
