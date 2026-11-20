"use client";
import { useEffect, useRef, type ReactNode } from "react";

// The picture at the top of Home: a balcony desk over a city, following the time of day (dawn, day, golden hour,
// dusk, night) and fading into the page. Drawn in SVG; the colours are CSS variables set once a minute, so nothing
// re-renders.

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
  return {
    "--sky0": mix(a[1], b[1], t),
    "--sky1": mix(a[2], b[2], t),
    "--sky2": horizon,
    "--fg": fg,
    "--leaf": mix(a[5], b[5], t),
    "--far": mix(fg, horizon, 0.45), // hazier further away
    "--near": mix(fg, horizon, 0.18),
    "--night": night.toFixed(3),
    "--cloud": (0.15 + (1 - night) * 0.75).toFixed(3),
    "--cloud-c": mix("#ffffff", a[3], 0.35 + 0.3 * night),
    "--wood": mix("#4a3326", fg, 0.35 + 0.45 * night),
    "--wood-hi": mix("#8a6248", fg, 0.3 + 0.45 * night),
    "--metal": mix("#80838c", fg, 0.35 + 0.45 * night),
    "--metal-hi": mix("#c9ccd3", fg, 0.3 + 0.45 * night),
    "--mug": mix("#efe8dc", fg, 0.25 + 0.5 * night),
    "--mug-lo": mix("#a79d90", fg, 0.35 + 0.45 * night),
    "--bezel": mix("#1d1e23", fg, 0.2),
    "--ui": mix("#4d6f9c", fg, 0.1),
  };
}

// Sun up 6:00–18:30, moon the rest, each on an arc across the sky; null: below the horizon.
function arc(h: number, rise: number, hours: number) {
  const p = ((((h - rise) % 24) + 24) % 24) / hours;
  return p >= 1 ? null : [80 + 1040 * p, 250 - 210 * Math.sin(Math.PI * p)];
}

// The same city on every load (and on the server): a seeded random.
function seeded(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}
const rnd = seeded(7);
const STARS = Array.from({ length: 80 }, () => ({ x: rnd() * 1200, y: rnd() * 150, r: rnd() * 1.2 + 0.3, delay: rnd() * 4 }));
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
const FAR = city(236, 40, 110, 22, 48, 0.75);
const NEAR = city(236, 18, 60, 30, 64, 0.85);
const POSTS = Array.from({ length: 50 }, (_, i) => 6 + i * 24);
// String lights along the wire's curve (M560 0 Q860 96 1200 46).
const BULBS = Array.from({ length: 13 }, (_, i) => {
  const t = (i + 1) / 14;
  return { x: (1 - t) ** 2 * 560 + 2 * (1 - t) * t * 860 + t * t * 1200, y: 2 * (1 - t) * t * 96 + t * t * 46 + 5, delay: (i * 0.37) % 2.8 };
});

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

  return (
    <div ref={root} className="home-scene relative -mb-12 h-52 overflow-hidden rounded-3xl lg:h-64">
      <svg viewBox="0 0 1200 300" preserveAspectRatio="xMaxYMax slice" aria-hidden className="absolute inset-0 size-full">
        <defs>
          <linearGradient id="hs-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--sky0)" }} />
            <stop offset=".55" style={{ stopColor: "var(--sky1)" }} />
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
          <radialGradient id="hs-warm">
            <stop offset="0" stopColor="#ffb867" stopOpacity=".75" />
            <stop offset="1" stopColor="#ffb867" stopOpacity="0" />
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

        <rect width="1200" height="300" fill="url(#hs-sky)" />
        <g style={{ opacity: "var(--night)" }}>
          {STARS.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" className="hs-twinkle" style={{ animationDelay: `${s.delay.toFixed(2)}s` }} />
          ))}
          <line className="hs-shoot" x1="760" y1="30" x2="800" y2="14" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
        </g>
        <g ref={sun} style={{ opacity: 0 }}>
          <circle r="70" fill="url(#hs-sun)" />
          <circle r="20" fill="#ffd98a" />
        </g>
        <g ref={moon} style={{ opacity: 0 }}>
          <circle r="60" fill="url(#hs-moon)" />
          <circle r="16" fill="#f3efdc" mask="url(#hs-crescent)" />
        </g>
        <g className="hs-clouds" style={{ opacity: "var(--cloud)", fill: "var(--cloud-c)" }}>
          <ellipse cx="120" cy="70" rx="60" ry="14" />
          <ellipse cx="150" cy="60" rx="34" ry="16" />
          <ellipse cx="520" cy="44" rx="80" ry="12" />
          <ellipse cx="560" cy="36" rx="40" ry="13" />
          <ellipse cx="930" cy="80" rx="54" ry="11" />
          <ellipse cx="900" cy="72" rx="30" ry="12" />
        </g>

        <g style={fill("--far")}>
          {FAR.blocks.map((b, i) => (
            <rect key={i} x={b.x} y={236 - b.h} width={b.w} height={b.h + 20} />
          ))}
        </g>
        <g>{windows(FAR.wins)}</g>
        <g style={fill("--near")}>
          {NEAR.blocks.map((b, i) => (
            <rect key={i} x={b.x} y={236 - b.h} width={b.w} height={b.h + 20} />
          ))}
        </g>
        <g>{windows(NEAR.wins)}</g>

        {/* The balcony rail. */}
        <g style={fill("--fg")}>
          <rect y="228" width="1200" height="7" rx="2" />
          {POSTS.map((x) => (
            <rect key={x} x={x} y="235" width="4" height="70" />
          ))}
        </g>

        {/* String lights. */}
        <path d="M560 0 Q 860 96 1200 46" fill="none" style={stroke("--fg")} strokeWidth="1.6" />
        {BULBS.map((b, i) => (
          <g key={i}>
            <g style={{ opacity: "var(--night)" }}>
              <circle cx={b.x} cy={b.y} r="12" fill="url(#hs-warm)" className="hs-bulb" style={{ animationDelay: `${b.delay.toFixed(2)}s` }} />
            </g>
            <circle cx={b.x} cy={b.y} r="3" fill="#ffd88f" style={{ opacity: "calc(.35 + var(--night) * .65)" }} />
          </g>
        ))}

        {/* A hanging plant, a cat on the rail, and a plant in a pot. */}
        <g className="hs-hang">
          <line x1="700" y1="0" x2="700" y2="44" style={stroke("--fg")} strokeWidth="1.5" />
          <path d="M684 44h32l-4 18h-24z" style={fill("--fg")} />
          <path
            d="M688 58c-6 16-4 30-10 44M696 60c0 18 4 26 0 46M708 58c6 14 2 26 8 38M702 60c-2 12-8 20-6 32"
            fill="none"
            style={stroke("--leaf")}
            strokeWidth="3"
            strokeLinecap="round"
          />
        </g>
        <g transform="translate(640 228)" style={fill("--fg")}>
          <path className="hs-tail" d="M14 -4c16 2 22 -10 18 -22" fill="none" style={stroke("--fg")} strokeWidth="4.5" strokeLinecap="round" />
          <ellipse className="hs-breathe" cy="-15" rx="17" ry="15" />
          <circle cx="-10" cy="-34" r="10" />
          <path d="M-18 -40l2 -11 6 7zM-6 -42l4 -10 3 9z" />
          <g style={{ opacity: "var(--night)" }} fill="#ffd36a">
            <circle cx="-13" cy="-35" r="1.4" />
            <circle cx="-6" cy="-35" r="1.4" />
          </g>
        </g>
        <g transform="translate(520 0)">
          <path d="M0 206h34l-4 22h-26z" style={fill("--fg")} />
          <g className="hs-sway" style={stroke("--leaf")} strokeWidth="4" strokeLinecap="round" fill="none">
            <path d="M17 206c-2 -20 -14 -30 -20 -44" />
            <path d="M17 206c2 -24 10 -34 20 -50" />
            <path d="M17 206c0 -18 0 -30 -2 -46" />
            <path d="M17 206c-6 -10 -18 -14 -26 -16" />
          </g>
        </g>

        {/* Up close, bottom right (hs-front scales it up): desk, lamp, mug, and a laptop, its screen lit at night. */}
        <g className="hs-front">
          <polygon points="1086,144 1062,218 1150,218 1116,144" fill="url(#hs-cone)" style={{ opacity: "var(--night)" }} />
          <circle cx="950" cy="190" r="90" fill="url(#hs-warm)" style={{ opacity: "calc(var(--night) * .55)" }} />

          {/* Desk: a wooden top with a lit front edge. */}
          <rect x="850" y="214" width="300" height="9" rx="2" fill="url(#hs-wood)" />
          <path d="M851 214.6h298" style={stroke("--wood-hi")} strokeWidth="1" opacity=".7" />
          <g style={fill("--fg")}>
            <rect x="866" y="223" width="7" height="95" />
            <rect x="1126" y="223" width="7" height="95" />
          </g>

          {/* Lamp. */}
          <rect x="1097" y="142" width="4" height="72" fill="url(#hs-metal)" />
          <ellipse cx="1099" cy="212" rx="15" ry="3.5" fill="url(#hs-metal)" />
          <path d="M1082 146l8 -22h18l8 22z" fill="url(#hs-lampshade)" />
          <g style={{ opacity: "var(--night)" }}>
            <ellipse className="hs-bulb" cx="1099" cy="146" rx="13" ry="3" fill="#ffd38a" />
          </g>

          {/* Mug, with steam. */}
          <path d="M1070 200c8 0 8 11 0 11" fill="none" style={stroke("--mug-lo")} strokeWidth="3" />
          <path d="M1054 196h16v15c0 2 -2 3 -4 3h-8c-2 0 -4 -1 -4 -3z" fill="url(#hs-mug)" />
          <ellipse cx="1062" cy="196" rx="8" ry="1.8" style={fill("--mug-lo")} />
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
          <polygon points="893,206 953,206 946,165 889,167" style={fill("--bezel")} />
          <polygon points="896,203 950,203 944,169 892,170.5" fill="url(#hs-display)" />
          <g style={stroke("--ui")} strokeWidth="1.3" strokeLinecap="round" opacity=".55">
            <path d="M895 174.5l46 -1" strokeWidth="2.6" opacity=".6" />
            <path d="M897 180l26 -.6M897.5 184l34 -.7M898 188l22 -.5M898.5 192l30 -.6M899 196l18 -.4" />
          </g>
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
