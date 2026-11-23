"use client";
import { useEffect, useRef, type ReactNode } from "react";

// The picture at the top of Home: a balcony desk over a city, following the time of day (dawn, day, golden hour,
// dusk, night) and fading into the page. Drawn in SVG; the colours are CSS variables set once a minute, so nothing
// re-renders. The drawing spans y -150 to 300: the sky above 0 is the extra height.

// Through the day: [hour, sky top, middle, horizon, foreground, leaves, night 0–1].
const KEYS: [number, string, string, string, string, string, number][] = [
  [0, "#060918", "#0f1433", "#1c2050", "#0b0a14", "#141a1c", 1],
  [5, "#060918", "#0f1433", "#1c2050", "#0b0a14", "#141a1c", 1],
  [6.3, "#1b2150", "#6a5590", "#f39c78", "#231c2e", "#22302a", 0.55],
  [7.6, "#5b98de", "#9fc6ee", "#f6d7b4", "#3a3142", "#33503e", 0.05],
  [10, "#4f8ee0", "#8dbff2", "#d4e8fa", "#3d3447", "#365a42", 0],
  [16, "#4f8ee0", "#8dbff2", "#d4e8fa", "#3d3447", "#365a42", 0],
  [17.6, "#4b5aa6", "#d5797a", "#ffb26f", "#2f2434", "#2d4334", 0.15],
  [19, "#1e2054", "#57397a", "#df6e58", "#1c1524", "#1e2a24", 0.6],
  [20.4, "#080b1d", "#121739", "#232355", "#0c0b16", "#151c1d", 1],
  [24, "#060918", "#0f1433", "#1c2050", "#0b0a14", "#141a1c", 1],
];
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a: string, b: string, t: number) =>
  "#" +
  rgb(a)
    .map((v, i) =>
      Math.round(v + (rgb(b)[i] - v) * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
const smooth = (t: number) => t * t * (3 - 2 * t);

// The scene's colours at an hour (0–24), as CSS variables.
export function sceneVars(h: number): Record<string, string> {
  h = ((h % 24) + 24) % 24;
  const i = KEYS.findIndex((k, j) => h >= k[0] && h < KEYS[j + 1][0]);
  const [a, b] = [KEYS[i], KEYS[i + 1]];
  const t = smooth((h - a[0]) / (b[0] - a[0]));
  const night = a[6] + (b[6] - a[6]) * t;
  const fg = mix(a[4], b[4], t);
  const horizon = mix(a[3], b[3], t);
  const sky1 = mix(a[2], b[2], t);
  const cloud = mix("#ffffff", a[3], 0.35 + 0.3 * night);
  // An object's own colour, darkened towards the foreground at night.
  const lit = (c: string, base: number) => mix(c, fg, base + 0.45 * night);
  return {
    "--sky0": mix(a[1], b[1], t),
    "--sky1": sky1,
    "--sky2": horizon,
    "--fg": fg,
    "--leaf": mix(a[5], b[5], t),
    "--haze": mix(fg, horizon, 0.68), // hazier further away
    "--far": mix(fg, horizon, 0.45),
    "--near": mix(fg, horizon, 0.18),
    "--night": night.toFixed(3),
    "--cloud": (0.15 + (1 - night) * 0.75).toFixed(3),
    "--cloud-c": cloud,
    "--cloud-lo": mix(cloud, sky1, 0.5),
    "--wood": lit("#4a3326", 0.35),
    "--wood-hi": lit("#8a6248", 0.3),
    "--metal": lit("#80838c", 0.35),
    "--metal-hi": lit("#c9ccd3", 0.3),
    "--mug": lit("#efe8dc", 0.25),
    "--mug-lo": lit("#a79d90", 0.35),
    "--book1": lit("#8a3d33", 0.3),
    "--book2": lit("#33566f", 0.3),
    "--book3": lit("#c49a52", 0.3),
    "--bezel": mix("#1d1e23", fg, 0.2),
    "--ui": mix("#4d6f9c", fg, 0.1),
  };
}

// Sun up 6:00–18:30, moon the rest, each on an arc across the sky; null: below the horizon.
function arc(h: number, rise: number, hours: number) {
  const p = ((((h - rise) % 24) + 24) % 24) / hours;
  return p >= 1 ? null : [80 + 1040 * p, 250 - 340 * Math.sin(Math.PI * p)];
}

// The same city on every load (and on the server): a seeded random.
function seeded(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}
const rnd = seeded(7);
const STARS = Array.from({ length: 140 }, () => ({ x: rnd() * 1200, y: rnd() * 290 - 150, r: rnd() * 1.2 + 0.3, delay: rnd() * 4 }));
type Win = { x: number; y: number; warm: boolean; at: number };
function city(base: number, minH: number, maxH: number, minW: number, maxW: number, warmth: number) {
  const blocks: { x: number; w: number; h: number }[] = [];
  const wins: Win[] = [];
  for (let x = -10; x < 1210;) {
    const w = minW + rnd() * (maxW - minW);
    const h = minH + rnd() * (maxH - minH);
    blocks.push({ x, w, h });
    for (let y = base - h + 8; y < base - 6; y += 9)
      for (let wx = x + 4; wx < x + w - 5; wx += 8) if (rnd() < 0.55) wins.push({ x: wx, y, warm: rnd() < warmth, at: rnd() * 0.8 });
    x += w + rnd() * 6;
  }
  return { blocks, wins };
}
const HAZE = city(236, 60, 150, 16, 36, 0).blocks;
const FAR = city(236, 40, 110, 22, 48, 0.75);
const NEAR = city(236, 18, 60, 30, 64, 0.85);
const MASTS = FAR.blocks.filter((b) => b.h > 92).map((b) => ({ x: b.x + b.w / 2, y: 236 - b.h, delay: rnd() * 2.4 }));
const TANKS = NEAR.blocks.filter((b, i) => i % 4 === 1 && b.w > 40).map((b) => ({ x: b.x + b.w * 0.3, y: 236 - b.h }));
const POSTS = Array.from({ length: 50 }, (_, i) => 6 + i * 24);
// String lights along the wire's curve (M560 0 Q860 96 1200 46).
const BULBS = Array.from({ length: 13 }, (_, i) => {
  const t = (i + 1) / 14;
  return { x: (1 - t) ** 2 * 560 + 2 * (1 - t) * t * 860 + t * t * 1200, y: 2 * (1 - t) * t * 96 + t * t * 46 + 5, delay: (i * 0.37) % 2.8 };
});
// A puffy cloud: a darker base and three lit puffs, each a soft radial gradient (no blur filter, so drifting stays cheap).
const CLOUDS = [
  [120, 40, 1],
  [560, 6, 1.2],
  [950, 56, 0.9],
  [330, 92, 0.6],
  [790, -60, 0.7],
];
const CIRRUS = [
  [200, -112, 170, 6],
  [700, -86, 120, 5],
  [1010, -124, 190, 7],
  [460, -40, 90, 4],
];
// Leaves on the hanging plant's vines: [x, y, angle].
const VINE_LEAVES = [
  [687, 66, 60],
  [683, 80, 110],
  [680, 95, 70],
  [696, 72, 100],
  [698, 88, 70],
  [696, 103, 110],
  [709, 68, 70],
  [712, 82, 120],
  [715, 95, 60],
  [701, 74, 120],
  [698, 86, 50],
];
// Leaves on the potted plant: [x, y, angle].
const POT_LEAVES = [
  [-3, 164, -60],
  [6, 180, -30],
  [37, 158, -120],
  [28, 176, -140],
  [15, 162, -95],
  [-9, 191, -20],
  [2, 198, -5],
];

export function HomeScene({ greeting }: { greeting: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const sun = useRef<SVGGElement>(null);
  const moon = useRef<SVGGElement>(null);

  // The time of day, once a minute.
  useEffect(() => {
    const paint = () => {
      const d = new Date();
      const h = d.getHours() + d.getMinutes() / 60;
      for (const [k, v] of Object.entries(sceneVars(h))) root.current?.style.setProperty(k, v);
      for (const [g, at] of [
        [sun.current, arc(h, 6, 12.5)],
        [moon.current, arc(h, 18.5, 11.5)],
      ] as const) {
        if (!g) continue;
        g.style.opacity = at ? "1" : "0";
        if (at) g.setAttribute("transform", `translate(${at[0]} ${at[1]})`);
      }
      root.current?.setAttribute("data-ready", "");
    };
    paint();
    const id = setInterval(paint, 60_000);
    return () => clearInterval(id);
  }, []);

  const fill = (v: string) => ({ fill: `var(${v})` });
  const stroke = (v: string) => ({ stroke: `var(${v})` });
  const atNight = (k = 1) => ({ opacity: k === 1 ? "var(--night)" : `calc(var(--night) * ${k})` });
  const byDay = (k = 1) => ({ opacity: `calc((1 - var(--night)) * ${k})` });
  const windows = (wins: Win[]) =>
    wins.map((w, i) => (
      <rect
        key={i}
        x={w.x}
        y={w.y}
        width="3"
        height="4"
        fill={w.warm ? "#ffcf7a" : "#bfe0ff"}
        style={{ opacity: `clamp(0, calc((var(--night) - ${w.at.toFixed(3)}) * 4), 0.9)` }}
      />
    ));
  // Buildings with a shaded side and a roof ledge, so they read as blocks rather than flat cut-outs.
  const blocks = (list: { x: number; w: number; h: number }[], colour: string, shade: number) => (
    <g style={fill(colour)}>
      {list.map((b, i) => (
        <g key={i}>
          <rect x={b.x} y={236 - b.h} width={b.w} height={b.h + 20} />
          <rect x={b.x - 1} y={236 - b.h} width={b.w + 2} height="2.2" />
          <rect x={b.x + b.w * 0.76} y={236 - b.h + 2} width={b.w * 0.24} height={b.h + 18} fill="#000" opacity={shade} />
        </g>
      ))}
    </g>
  );

  return (
    <div ref={root} className="home-scene relative -mb-12 h-78 overflow-hidden rounded-3xl lg:h-96">
      <svg viewBox="0 -150 1200 450" preserveAspectRatio="xMaxYMax slice" aria-hidden className="absolute inset-0 size-full">
        <defs>
          <linearGradient id="hs-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--sky0)" }} />
            <stop offset=".6" style={{ stopColor: "var(--sky1)" }} />
            <stop offset="1" style={{ stopColor: "var(--sky2)" }} />
          </linearGradient>
          <radialGradient id="hs-sun">
            <stop offset="0" stopColor="#ffe2a0" stopOpacity=".9" />
            <stop offset="1" stopColor="#ffb35c" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="hs-moon">
            <stop offset="0" stopColor="#e8ecff" stopOpacity=".45" />
            <stop offset="1" stopColor="#e8ecff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="hs-milky">
            <stop offset="0" stopColor="#c9d2ff" stopOpacity=".22" />
            <stop offset=".5" stopColor="#a9b4ef" stopOpacity=".08" />
            <stop offset="1" stopColor="#a9b4ef" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="hs-puff" cy=".42">
            <stop offset="0" style={{ stopColor: "var(--cloud-c)" }} />
            <stop offset=".55" style={{ stopColor: "var(--cloud-c)", stopOpacity: 0.75 }} />
            <stop offset="1" style={{ stopColor: "var(--cloud-c)", stopOpacity: 0 }} />
          </radialGradient>
          <radialGradient id="hs-puff-lo">
            <stop offset="0" style={{ stopColor: "var(--cloud-lo)" }} />
            <stop offset=".6" style={{ stopColor: "var(--cloud-lo)", stopOpacity: 0.6 }} />
            <stop offset="1" style={{ stopColor: "var(--cloud-lo)", stopOpacity: 0 }} />
          </radialGradient>
          <linearGradient id="hs-cityglow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff9a5a" stopOpacity="0" />
            <stop offset="1" stopColor="#ff9a5a" stopOpacity=".45" />
          </linearGradient>
          <linearGradient id="hs-mist" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--sky2)", stopOpacity: 0 }} />
            <stop offset="1" style={{ stopColor: "var(--sky2)", stopOpacity: 0.5 }} />
          </linearGradient>
          <linearGradient id="hs-trail" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#fff" stopOpacity=".7" />
          </linearGradient>
          <radialGradient id="hs-warm">
            <stop offset="0" stopColor="#ffb867" stopOpacity=".75" />
            <stop offset="1" stopColor="#ffb867" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="hs-red">
            <stop offset="0" stopColor="#ff4a3d" stopOpacity=".8" />
            <stop offset="1" stopColor="#ff4a3d" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="hs-screen">
            <stop offset="0" stopColor="#9fd0ff" stopOpacity=".7" />
            <stop offset="1" stopColor="#9fd0ff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="hs-cone" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffcf87" stopOpacity=".55" />
            <stop offset="1" stopColor="#ffcf87" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="hs-display" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#e4f2ff" />
            <stop offset="1" stopColor="#7fb0e6" />
          </linearGradient>
          <mask id="hs-crescent">
            <circle r="16" fill="#fff" />
            <circle cx="7" cy="-5" r="14" fill="#000" />
          </mask>
          <linearGradient id="hs-wood" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--wood-hi)" }} />
            <stop offset="1" style={{ stopColor: "var(--wood)" }} />
          </linearGradient>
          <linearGradient id="hs-metal" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" style={{ stopColor: "var(--metal-hi)" }} />
            <stop offset="1" style={{ stopColor: "var(--metal)" }} />
          </linearGradient>
          <linearGradient id="hs-mug" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" style={{ stopColor: "var(--mug)" }} />
            <stop offset="1" style={{ stopColor: "var(--mug-lo)" }} />
          </linearGradient>
          <linearGradient id="hs-lampshade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" style={{ stopColor: "var(--near)" }} />
            <stop offset="1" style={{ stopColor: "var(--fg)" }} />
          </linearGradient>
        </defs>

        <rect y="-150" width="1200" height="450" fill="url(#hs-sky)" />

        {/* Night sky: the Milky Way, stars, a shooting star, and the city's glow on the horizon. */}
        <g style={atNight()}>
          <ellipse cx="330" cy="-40" rx="460" ry="46" fill="url(#hs-milky)" transform="rotate(-16 330 -40)" />
          <ellipse cx="420" cy="-66" rx="200" ry="18" fill="url(#hs-milky)" transform="rotate(-16 420 -66)" />
          {STARS.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" className="hs-twinkle" style={{ animationDelay: `${s.delay.toFixed(2)}s` }} />
          ))}
          <line className="hs-shoot" x1="760" y1="-100" x2="800" y2="-116" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
          <rect y="60" width="1200" height="176" fill="url(#hs-cityglow)" />
        </g>

        <g ref={sun} style={{ opacity: 0 }}>
          <circle r="170" fill="url(#hs-sun)" opacity=".35" />
          <circle r="70" fill="url(#hs-sun)" />
          <circle r="20" fill="#ffd98a" />
          <circle r="14" fill="#fff3d0" opacity=".6" />
        </g>
        <g ref={moon} style={{ opacity: 0 }}>
          <circle r="60" fill="url(#hs-moon)" />
          <g mask="url(#hs-crescent)">
            <circle r="16" fill="#f3efdc" />
            <g fill="#d6d0ba">
              <circle cx="-9" cy="2" r="2.6" />
              <circle cx="-4" cy="9" r="1.8" />
              <circle cx="-11" cy="-6" r="1.5" />
              <circle cx="-2" cy="13" r="1.1" />
            </g>
          </g>
        </g>

        {/* High thin cloud, an aeroplane (a contrail by day, blinking lights by night) and a few birds. */}
        <g className="hs-cirrus" style={{ opacity: "calc(var(--cloud) * .7)" }}>
          {CIRRUS.map(([x, y, rx, ry], i) => (
            <ellipse key={i} cx={x} cy={y} rx={rx} ry={ry} fill="url(#hs-puff)" />
          ))}
        </g>
        <g transform="translate(0 -98)">
          <g className="hs-fly">
            <rect x="-150" y="-0.8" width="140" height="1.6" fill="url(#hs-trail)" style={byDay(0.8)} />
            <path d="M-8 -.9h15c1.4 0 2.4 .5 2.4 .9s-1 .9 -2.4 .9h-15zM-1 -.6l-4 -5h2.2l5.5 5zM-1 .6l-4 4h2.2l5.5 -4zM-7.5 -.6l-2 -3h1.4l2.6 3z" style={fill("--far")} />
            <g style={atNight()}>
              <circle className="hs-blink" cx="-2" cy="-4.6" r="1.3" fill="#ff5a4d" />
              <circle className="hs-blink" cx="9" cy="0" r="1.1" fill="#fff" style={{ animationDelay: "1.2s" }} />
            </g>
          </g>
        </g>
        <g style={byDay()}>
          <g className="hs-birds" style={stroke("--fg")} fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            {[
              [0, -40, 0],
              [22, -48, 0.25],
              [14, -30, 0.5],
              [40, -38, 0.15],
            ].map(([x, y, d], i) => (
              <g key={i} transform={`translate(${x} ${y})`}>
                <path className="hs-flap" d="M0 0q4 -4 8 0q4 -4 8 0" style={{ animationDelay: `${d}s` }} />
              </g>
            ))}
          </g>
        </g>
        <g className="hs-clouds" style={{ opacity: "var(--cloud)" }}>
          {CLOUDS.map(([x, y, s], i) => (
            <g key={i}>
              <ellipse cx={x} cy={y + 8 * s} rx={78 * s} ry={15 * s} fill="url(#hs-puff-lo)" />
              <ellipse cx={x - 30 * s} cy={y} rx={36 * s} ry={20 * s} fill="url(#hs-puff)" />
              <ellipse cx={x + 6 * s} cy={y - 8 * s} rx={42 * s} ry={25 * s} fill="url(#hs-puff)" />
              <ellipse cx={x + 42 * s} cy={y + 2 * s} rx={30 * s} ry={17 * s} fill="url(#hs-puff)" />
            </g>
          ))}
        </g>

        {/* The city in three layers, hazier further back, with masts and rooftop water tanks. */}
        <g style={fill("--haze")}>
          {HAZE.map((b, i) => (
            <rect key={i} x={b.x} y={236 - b.h} width={b.w} height={b.h + 20} />
          ))}
        </g>
        {blocks(FAR.blocks, "--far", 0.1)}
        <g style={stroke("--far")} strokeWidth="1.2">
          {MASTS.map((m, i) => (
            <path key={i} d={`M${m.x} ${m.y}v-18M${m.x - 3} ${m.y - 6}h6`} />
          ))}
        </g>
        <g style={{ opacity: "calc(.25 + var(--night) * .75)" }}>
          {MASTS.map((m, i) => (
            <g key={i} className="hs-blink" style={{ animationDelay: `${m.delay.toFixed(2)}s` }}>
              <circle cx={m.x} cy={m.y - 18} r="6" fill="url(#hs-red)" />
              <circle cx={m.x} cy={m.y - 18} r="1.4" fill="#ff5a4d" />
            </g>
          ))}
        </g>
        <g>{windows(FAR.wins)}</g>
        <rect y="150" width="1200" height="86" fill="url(#hs-mist)" />
        {blocks(NEAR.blocks, "--near", 0.16)}
        <g style={fill("--near")}>
          {TANKS.map((t, i) => (
            <path key={i} d={`M${t.x} ${t.y}v-6h1v6zM${t.x + 9} ${t.y}v-6h1v6zM${t.x - 1} ${t.y - 6}h12v-9h-12zM${t.x - 2} ${t.y - 15}l7 -5l7 5z`} />
          ))}
        </g>
        <g>{windows(NEAR.wins)}</g>

        {/* The balcony rail, lit along its top edge by the sky. */}
        <g style={fill("--fg")}>
          <rect y="228" width="1200" height="7" rx="2" />
          {POSTS.map((x) => (
            <rect key={x} x={x} y="235" width="4" height="70" />
          ))}
        </g>
        <rect y="228" width="1200" height="1.3" style={fill("--sky2")} opacity=".4" />

        {/* String lights. */}
        <path d="M560 0 Q 860 96 1200 46" fill="none" style={stroke("--fg")} strokeWidth="1.6" />
        {BULBS.map((b, i) => (
          <g key={i}>
            <g style={atNight()}>
              <circle cx={b.x} cy={b.y} r="12" fill="url(#hs-warm)" className="hs-bulb" style={{ animationDelay: `${b.delay.toFixed(2)}s` }} />
            </g>
            <path d={`M${b.x} ${b.y - 5}v2`} style={stroke("--fg")} strokeWidth="2" />
            <circle cx={b.x} cy={b.y} r="3" fill="#ffd88f" style={{ opacity: "calc(.35 + var(--night) * .65)" }} />
          </g>
        ))}

        {/* A hanging plant, a cat on the rail, and a plant in a pot. */}
        <g className="hs-hang">
          <path d="M700 -150V40M700 40l-14 4M700 40l14 4" style={stroke("--fg")} strokeWidth="1.2" fill="none" />
          <path d="M684 44h32l-4 18h-24z" style={fill("--fg")} />
          <rect x="682" y="42" width="36" height="4" rx="1.5" style={fill("--fg")} />
          <path
            d="M688 58c-6 16-4 30-10 44M696 60c0 18 4 26 0 46M708 58c6 14 2 26 8 38M702 60c-2 12-8 20-6 32"
            fill="none"
            style={stroke("--leaf")}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <g style={fill("--leaf")}>
            {VINE_LEAVES.map(([x, y, a], i) => (
              <ellipse key={i} cx={x} cy={y} rx="5" ry="2.6" transform={`rotate(${a} ${x} ${y})`} />
            ))}
          </g>
        </g>
        <g transform="translate(640 228)" style={fill("--fg")}>
          <path className="hs-tail" d="M14 -4c16 2 22 -10 18 -22" fill="none" style={stroke("--fg")} strokeWidth="4.5" strokeLinecap="round" />
          <ellipse className="hs-breathe" cy="-15" rx="17" ry="15" />
          <circle cx="-10" cy="-34" r="10" />
          <path d="M-18 -40l2 -11 6 7zM-6 -42l4 -10 3 9z" />
          <path d="M-15 -28a17 15 0 0 1 30 -1M-19 -38a10 10 0 0 1 13 -6" fill="none" style={stroke("--sky2")} strokeWidth="1.2" opacity=".35" />
          <g style={atNight()} fill="#ffd36a">
            <circle cx="-13" cy="-35" r="1.4" />
            <circle cx="-6" cy="-35" r="1.4" />
          </g>
        </g>
        <g transform="translate(520 0)">
          <g className="hs-sway">
            <g style={stroke("--leaf")} strokeWidth="2.4" strokeLinecap="round" fill="none">
              <path d="M17 206c-2 -20 -14 -30 -20 -44" />
              <path d="M17 206c2 -24 10 -34 20 -50" />
              <path d="M17 206c0 -18 0 -30 -2 -46" />
              <path d="M17 206c-6 -10 -18 -14 -26 -16" />
            </g>
            <g style={fill("--leaf")}>
              {POT_LEAVES.map(([x, y, a], i) => (
                <path key={i} d="M0 0c4 -5 11 -7 17 -5c-4 5 -11 7 -17 5z" transform={`translate(${x} ${y}) rotate(${a})`} />
              ))}
            </g>
          </g>
          <path d="M0 206h34l-4 22h-26z" style={fill("--fg")} />
          <rect x="-2" y="203" width="38" height="4" rx="1.5" style={fill("--fg")} />
          <path d="M2 207.4h30" style={stroke("--sky2")} strokeWidth="1" opacity=".3" />
        </g>

        {/* Up close, bottom right (hs-front scales it up): desk, lamp, mug, books, pencils and a laptop, its screen lit at night. */}
        <g className="hs-front">
          <polygon points="1086,144 1062,218 1150,218 1116,144" fill="url(#hs-cone)" style={atNight()} />
          <circle cx="950" cy="190" r="90" fill="url(#hs-warm)" style={atNight(0.55)} />

          {/* Desk: a wooden top with a lit front edge, grain, and pools of light from the lamp and the screen. */}
          <rect x="850" y="214" width="300" height="9" rx="2" fill="url(#hs-wood)" />
          <path d="M851 214.6h298" style={stroke("--wood-hi")} strokeWidth="1" opacity=".7" />
          <path d="M856 218.4c40 -.7 80 .6 120 0s90 -.7 168 .2M860 220.6c50 .5 96 -.6 140 0s80 .5 140 -.3" style={stroke("--wood")} strokeWidth=".5" fill="none" opacity=".8" />
          <ellipse cx="1098" cy="214.4" rx="58" ry="3" fill="#ffcf87" style={atNight(0.5)} />
          <ellipse cx="925" cy="214.4" rx="48" ry="2.6" fill="#9fd0ff" style={atNight(0.35)} />
          <g style={fill("--fg")}>
            <rect x="866" y="223" width="7" height="95" />
            <rect x="1126" y="223" width="7" height="95" />
          </g>
          <g fill="#000" opacity=".28">
            <ellipse cx="925" cy="214.3" rx="38" ry="1.6" />
            <ellipse cx="1062" cy="214.3" rx="10" ry="1.2" />
            <ellipse cx="1014" cy="214.3" rx="26" ry="1.4" />
            <ellipse cx="868" cy="214.3" rx="8" ry="1.1" />
          </g>

          {/* A cup of pencils. */}
          <g strokeLinecap="round">
            <path d="M864 200l-5 -15M868 200l1 -17M871 200l5 -14" stroke="#d9a441" strokeWidth="2" style={{ opacity: "calc(1 - var(--night) * .6)" }} />
            <path d="M859 185l-.6 -1.8M869 183v-1.8M876 186l.7 -1.7" style={stroke("--fg")} strokeWidth="2" />
          </g>
          <path d="M861 199h14l-1 15h-12z" fill="url(#hs-metal)" />

          {/* A stack of books, pages showing on the right. */}
          {(
            [
              [990, 208, 48, 6, "--book1"],
              [994, 203, 41, 5, "--book2"],
              [991, 199, 45, 4, "--book3"],
            ] as const
          ).map(([x, y, w, h, c], i) => (
            <g key={i}>
              <rect x={x} y={y} width={w} height={h} rx=".8" style={fill(c)} />
              <rect x={x + 3} y={y + 1} width={w - 3} height={h - 2} style={fill("--mug")} />
              <path d={`M${x + 4} ${y + h / 2}h${w - 5}`} style={stroke("--mug-lo")} strokeWidth=".4" />
            </g>
          ))}

          {/* Lamp. */}
          <rect x="1097" y="142" width="4" height="72" fill="url(#hs-metal)" />
          <ellipse cx="1099" cy="212" rx="15" ry="3.5" fill="url(#hs-metal)" />
          <path d="M1084 212h30" style={stroke("--metal-hi")} strokeWidth=".8" opacity=".6" />
          <path d="M1082 146l8 -22h18l8 22z" fill="url(#hs-lampshade)" />
          <path d="M1090 124h18" style={stroke("--sky2")} strokeWidth=".8" opacity=".35" />
          <g style={atNight()}>
            <ellipse className="hs-bulb" cx="1099" cy="146" rx="13" ry="3" fill="#ffd38a" />
          </g>

          {/* Mug, with steam. */}
          <path d="M1070 200c8 0 8 11 0 11" fill="none" style={stroke("--mug-lo")} strokeWidth="3" />
          <path d="M1054 196h16v15c0 2 -2 3 -4 3h-8c-2 0 -4 -1 -4 -3z" fill="url(#hs-mug)" />
          <ellipse cx="1062" cy="196" rx="8" ry="1.8" style={fill("--mug-lo")} />
          <ellipse cx="1062" cy="196.4" rx="6.4" ry="1.2" fill="#4a2c1c" />
          <path d="M1056.5 199v10" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" opacity=".35" />
          <g fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round">
            <path className="hs-steam" d="M1059 192c-4 -6 4 -10 0 -16" />
            <path className="hs-steam" style={{ animationDelay: "1.6s" }} d="M1066 192c-4 -6 4 -10 0 -16" />
          </g>

          {/* Laptop: aluminium deck and lid, and the screen showing a document. */}
          <g style={{ opacity: "calc(.2 + var(--night) * .8)" }}>
            <ellipse className="hs-screen" cx="925" cy="188" rx="58" ry="40" fill="url(#hs-screen)" />
          </g>
          <polygon points="892,214 962,214 953,206 893,206" fill="url(#hs-metal)" />
          <path d="M898 210.5h56M900 208.4h50" style={stroke("--fg")} strokeWidth=".6" opacity=".35" />
          <path d="M916 212.6h22" style={stroke("--fg")} strokeWidth=".8" opacity=".3" />
          <polygon points="893,206 953,206 946,165 889,167" style={fill("--bezel")} />
          <polygon points="896,203 950,203 944,169 892,170.5" fill="url(#hs-display)" />
          <g style={stroke("--ui")} strokeWidth="1.3" strokeLinecap="round" opacity=".55">
            <path d="M895 174.5l46 -1" strokeWidth="2.6" opacity=".6" />
            <path d="M897 180l26 -.6M897.5 184l34 -.7M898 188l22 -.5M898.5 192l30 -.6M899 196l18 -.4" />
          </g>
          <polygon points="892,170.5 912,170 899,203 896,203" fill="#fff" opacity=".1" />
          <circle cx="917.5" cy="167.2" r=".7" fill="#000" opacity=".6" />
          <path d="M889 167l57 -2" stroke="#fff" strokeOpacity=".25" strokeWidth=".8" />
        </g>
      </svg>
      {/* The greeting: over the sky at the top on phones (the desk is lower down there), at the bottom on wide screens. */}
      <h1 className="absolute top-4 left-4 font-serif text-2xl text-white [text-shadow:0_2px_18px_rgb(0_0_0/0.45)] lg:top-auto lg:bottom-16 lg:left-6 lg:text-4xl">
        {greeting}
      </h1>
    </div>
  );
}
