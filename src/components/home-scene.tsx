"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { WEATHERS, type Weather } from "../lib/weather";

// The picture at the top of Home: a desk in a high-rise office, looking out through a glass wall at the city, the
// sky, birds and aeroplanes, following the time of day (dawn, day, golden hour, dusk, night) and fading into the
// page. Drawn in SVG; the colours are CSS variables set once a minute, so nothing re-renders. The drawing spans
// y -150 (the ceiling) to 300.

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

// How grey each weather turns the sky (0 clear – 1 fully overcast).
const GREY: Record<Weather, number> = { clear: 0, cloudy: 0.45, fog: 0.55, snow: 0.55, rain: 0.7, storm: 0.85 };

// The scene's colours at an hour (0–24), greyed by the weather, as CSS variables.
export function sceneVars(h: number, grey = 0): Record<string, string> {
  h = ((h % 24) + 24) % 24;
  const i = KEYS.findIndex((k, j) => h >= k[0] && h < KEYS[j + 1][0]);
  const [a, b] = [KEYS[i], KEYS[i + 1]];
  const t = smooth((h - a[0]) / (b[0] - a[0]));
  const night = a[6] + (b[6] - a[6]) * t;
  const fg = mix(a[4], b[4], t);
  const overcast = mix("#8f98a3", "#14171e", night);
  const horizon = mix(mix(a[3], b[3], t), overcast, grey * 0.8);
  const sky1 = mix(mix(a[2], b[2], t), overcast, grey);
  const cloud = mix(mix("#ffffff", a[3], 0.35 + 0.3 * night), overcast, grey * 0.5);
  // An object's own colour, darkened towards the foreground at night.
  const lit = (c: string, base: number) => mix(c, fg, base + 0.45 * night);
  return {
    "--sky0": mix(mix(a[1], b[1], t), overcast, grey),
    "--sky1": sky1,
    "--sky2": horizon,
    "--fg": fg,
    "--leaf": mix(a[5], b[5], t),
    "--leaf-hi": lit("#c4cf6e", 0.35),
    "--haze": mix(fg, horizon, 0.68), // hazier further away
    "--far": mix(fg, horizon, 0.45),
    "--near": mix(fg, horizon, 0.18),
    "--tower": mix(fg, horizon, 0.3),
    "--tower-hi": mix(mix(sky1, horizon, 0.5), fg, 0.25 + 0.55 * night), // glass towers mirror the sky
    "--night": night.toFixed(3),
    "--cloud": (0.15 + (1 - night) * 0.75).toFixed(3),
    "--cloud-c": cloud,
    "--cloud-lo": mix(cloud, sky1, 0.5),
    "--cloud-dk": mix(cloud, mix("#59616c", "#181b22", night), 0.6), // rain clouds
    "--ceil": lit("#34373e", 0.2),
    "--frame": lit("#3b3f47", 0.3),
    "--sill": lit("#9a9ea7", 0.3),
    "--wall": lit("#2b2d33", 0.25),
    "--blind": lit("#d9d2c3", 0.3),
    "--planter": lit("#e9e5dd", 0.3),
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
// Aircraft-warning lights: on the tallest far blocks, the crane and the spire.
const MASTS = FAR.blocks.filter((b) => b.h > 92).map((b) => ({ x: b.x + b.w / 2, y: 236 - b.h - 18, delay: rnd() * 2.4 }));
const LIGHTS = [...MASTS, { x: 779, y: 40, delay: 0.7 }, { x: 322, y: 6, delay: 1.5 }];
const TANKS = NEAR.blocks.filter((b, i) => i % 4 === 1 && b.w > 40).map((b) => ({ x: b.x + b.w * 0.3, y: 236 - b.h }));
// The crane's lattice mast, as a zigzag.
const LATTICE = "M776 236" + Array.from({ length: 21 }, (_, i) => `L${i % 2 ? 776 : 782} ${228 - i * 8}`).join("");
// A puffy cloud: a darker base and three lit puffs, each a soft radial gradient (no blur filter, so drifting stays cheap).
const CLOUDS = [
  [120, 40, 1],
  [560, 6, 1.2],
  [950, 56, 0.9],
  [330, 92, 0.6],
  [790, -60, 0.7],
];
// Clouds are drawn twice, 1400 apart, and drift exactly 1400 per loop, so the restart lands where the copy was (no pop-in).
const WRAP = [0, -1400];
const CIRRUS = [
  [200, -96, 170, 6],
  [700, -80, 120, 5],
  [1010, -100, 190, 7],
  [460, -40, 90, 4],
];
// The glass wall: mullions, and the ceiling's light panels.
const MULLIONS = [200, 440, 680, 920, 1160];
const PANELS = [120, 420, 720, 1020];
// A snake plant on the window ledge: [base x, height (negative is up), lean].
const SNAKE = [
  [552, -62, -9],
  [558, -88, -4],
  [566, -104, 1],
  [574, -84, 6],
  [582, -58, 12],
  [562, -50, -15],
  [571, -70, 11],
];
// Weather: big low clouds when it isn't clear, and raindrops on the glass when it rains.
const HEAVY = [
  [90, -30, 1.7],
  [420, -60, 1.9],
  [720, 0, 1.6],
  [1030, -40, 1.8],
  [260, 50, 1.3],
  [890, 70, 1.2],
];
const DROPS = Array.from({ length: 90 }, () => ({ x: rnd() * 1200, y: rnd() * 330 - 112, r: 0.8 + rnd() * 1.8 }));
const FLAKES = Array.from({ length: 14 }, () => ({ x: 3 + rnd() * 154, y: 3 + rnd() * 154, r: 0.9 + rnd() * 1.3, o: 0.6 + rnd() * 0.4 }));
const TRICKLES = [
  [150, -60, 0],
  [505, -20, 2.3],
  [790, -80, 4.1],
  [1080, -40, 1.2],
];

export function HomeScene({ greeting }: { greeting: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const sun = useRef<SVGGElement>(null);
  const moon = useRef<SVGGElement>(null);
  const [kind, setKind] = useState<Weather>("clear");
  const grey = GREY[kind];

  // The weather where the viewer is, every 20 minutes. ?weather=rain (or any look) shows that look instead.
  useEffect(() => {
    const forced = new URLSearchParams(location.search).get("weather") as Weather;
    const load = () =>
      (WEATHERS.includes(forced) ? Promise.resolve({ kind: forced }) : fetch("/api/weather").then((r) => r.json()))
        .then((w) => w.kind && setKind(w.kind))
        .catch(() => {});
    load();
    const id = setInterval(load, 20 * 60_000);
    return () => clearInterval(id);
  }, []);

  // The time of day, once a minute.
  useEffect(() => {
    const paint = () => {
      const d = new Date();
      const h = d.getHours() + d.getMinutes() / 60;
      for (const [k, v] of Object.entries(sceneVars(h, grey))) root.current?.style.setProperty(k, v);
      for (const [g, at] of [
        [sun.current, arc(h, 6, 12.5)],
        [moon.current, arc(h, 18.5, 11.5)],
      ] as const) {
        if (!g) continue;
        g.style.opacity = at ? String(1 - grey * 0.9) : "0"; // behind the clouds
        if (at) g.setAttribute("transform", `translate(${at[0]} ${at[1]})`);
      }
      root.current?.setAttribute("data-ready", "");
    };
    paint();
    const id = setInterval(paint, 60_000);
    return () => clearInterval(id);
  }, [grey]);
  const wet = kind === "rain" || kind === "storm";

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
  // A glass tower: the sky in its glass, floor lines, offices lit at night, and a shaded side.
  const tower = (d: string, x: number, w: number) => (
    <g>
      <clipPath id={`hs-t${x}`}>
        <path d={d} />
      </clipPath>
      <path d={d} fill="url(#hs-glass)" />
      <path d={d} fill="url(#hs-floors)" />
      <path d={d} fill="url(#hs-lit)" style={atNight(0.55)} />
      <rect x={x + w * 0.72} y="0" width={w * 0.28} height="240" fill="#000" opacity=".14" clipPath={`url(#hs-t${x})`} />
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
          <linearGradient id="hs-glass" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: "var(--tower-hi)" }} />
            <stop offset=".7" style={{ stopColor: "var(--tower)" }} />
          </linearGradient>
          <pattern id="hs-floors" width="8" height="6" patternUnits="userSpaceOnUse">
            <rect width="8" height="1" fill="#000" opacity=".28" />
            <rect x="7" width="1" height="6" fill="#000" opacity=".12" />
          </pattern>
          <pattern id="hs-lit" width="16" height="12" patternUnits="userSpaceOnUse">
            <rect x="1" y="1.5" width="6" height="3.5" fill="#ffe2a8" />
            <rect x="9" y="7.5" width="6" height="3.5" fill="#cfe6ff" opacity=".7" />
          </pattern>
          <linearGradient id="hs-sheen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".16" />
            <stop offset="1" stopColor="#fff" stopOpacity=".02" />
          </linearGradient>
          <radialGradient id="hs-panel">
            <stop offset="0" stopColor="#fff6e6" stopOpacity=".55" />
            <stop offset="1" stopColor="#fff6e6" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="hs-red">
            <stop offset="0" stopColor="#ff4a3d" stopOpacity=".8" />
            <stop offset="1" stopColor="#ff4a3d" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="hs-screen">
            <stop offset="0" stopColor="#9fd0ff" stopOpacity=".7" />
            <stop offset="1" stopColor="#9fd0ff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="hs-display" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#e4f2ff" />
            <stop offset="1" stopColor="#7fb0e6" />
          </linearGradient>
          <linearGradient id="hs-monitor" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f6f8fc" />
            <stop offset="1" stopColor="#c9d6ea" />
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
          <radialGradient id="hs-puff-dk" cy=".45">
            <stop offset="0" style={{ stopColor: "var(--cloud-dk)" }} />
            <stop offset=".6" style={{ stopColor: "var(--cloud-dk)", stopOpacity: 0.8 }} />
            <stop offset="1" style={{ stopColor: "var(--cloud-dk)", stopOpacity: 0 }} />
          </radialGradient>
          {/* Rain and snow tile; each layer slides exactly a whole number of tiles per loop, so it never jumps. */}
          <pattern id="hs-rain" width="40" height="60" patternUnits="userSpaceOnUse">
            <path d="M8 2l-4 12M30 22l-4 12M18 40l-4 12M37 48l-3 9" stroke="#dbe7f5" strokeWidth="1" strokeLinecap="round" />
          </pattern>
          <pattern id="hs-snow" width="160" height="160" patternUnits="userSpaceOnUse">
            <g fill="#fff">
              {FLAKES.map((f, i) => (
                <circle key={i} cx={f.x} cy={f.y} r={f.r} opacity={f.o} />
              ))}
            </g>
          </pattern>
          <linearGradient id="hs-fog" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--sky2)", stopOpacity: 0.15 }} />
            <stop offset=".55" style={{ stopColor: "var(--sky2)", stopOpacity: 0.7 }} />
            <stop offset="1" style={{ stopColor: "var(--sky2)", stopOpacity: 0.9 }} />
          </linearGradient>
          <clipPath id="hs-wall">
            <rect y="-116" width="1200" height="338" />
          </clipPath>
        </defs>

        {/* Outside: the sky. */}
        <rect y="-150" width="1200" height="450" fill="url(#hs-sky)" />
        <g style={atNight(1 - grey * 0.9)}>
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
        <g className="hs-cirrus" style={{ opacity: "calc(var(--cloud) * .7)" }}>
          {WRAP.map((dx) =>
            CIRRUS.map(([x, y, rx, ry], i) => <ellipse key={`${dx}-${i}`} cx={x + dx} cy={y} rx={rx} ry={ry} fill="url(#hs-puff)" />),
          )}
        </g>
        <g transform="translate(0 -92)">
          <g className="hs-fly">
            <rect x="-150" y="-0.8" width="140" height="1.6" fill="url(#hs-trail)" style={byDay(0.8)} />
            <path d="M-8 -.9h15c1.4 0 2.4 .5 2.4 .9s-1 .9 -2.4 .9h-15zM-1 -.6l-4 -5h2.2l5.5 5zM-1 .6l-4 4h2.2l5.5 -4zM-7.5 -.6l-2 -3h1.4l2.6 3z" style={fill("--far")} />
            <g style={atNight()}>
              <circle className="hs-blink" cx="-2" cy="-4.6" r="1.3" fill="#ff5a4d" />
              <circle className="hs-blink" cx="9" cy="0" r="1.1" fill="#fff" style={{ animationDelay: "1.2s" }} />
            </g>
          </g>
        </g>
        <g style={byDay(wet || kind === "snow" ? 0 : 1)}>
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
          {WRAP.map((dx) =>
            CLOUDS.map(([x, y, s], i) => (
              <g key={`${dx}-${i}`} transform={`translate(${dx} 0)`}>
                <ellipse cx={x} cy={y + 8 * s} rx={78 * s} ry={15 * s} fill="url(#hs-puff-lo)" />
                <ellipse cx={x - 30 * s} cy={y} rx={36 * s} ry={20 * s} fill="url(#hs-puff)" />
                <ellipse cx={x + 6 * s} cy={y - 8 * s} rx={42 * s} ry={25 * s} fill="url(#hs-puff)" />
                <ellipse cx={x + 42 * s} cy={y + 2 * s} rx={30 * s} ry={17 * s} fill="url(#hs-puff)" />
              </g>
            )),
          )}
        </g>
        {/* Weather: a low grey cloud deck, and lightning in a storm. */}
        {grey > 0 && (
          <g className="hs-heavy" style={{ opacity: `calc(${Math.min(1, grey * 1.25)} * (.55 + (1 - var(--night)) * .45))` }}>
            {WRAP.map((dx) =>
              HEAVY.map(([x, y, s], i) => (
                <g key={`${dx}-${i}`} transform={`translate(${dx} 0)`}>
                  <ellipse cx={x} cy={y + 12 * s} rx={95 * s} ry={22 * s} fill="url(#hs-puff-dk)" />
                  <ellipse cx={x - 36 * s} cy={y} rx={44 * s} ry={26 * s} fill="url(#hs-puff)" />
                  <ellipse cx={x + 8 * s} cy={y - 10 * s} rx={52 * s} ry={30 * s} fill="url(#hs-puff)" />
                  <ellipse cx={x + 50 * s} cy={y + 4 * s} rx={38 * s} ry={22 * s} fill="url(#hs-puff-dk)" />
                </g>
              )),
            )}
          </g>
        )}
        {kind === "storm" && (
          <g className="hs-flash">
            <rect y="-116" width="1200" height="338" fill="#e6ecff" opacity=".55" />
            <path d="M430 -70l-14 42h12l-18 46h10l-22 52" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinejoin="round" />
          </g>
        )}

        {/* Outside: the city in layers, hazier further back, with a crane, masts, glass towers and water tanks. */}
        <g style={fill("--haze")}>
          {HAZE.map((b, i) => (
            <rect key={i} x={b.x} y={236 - b.h} width={b.w} height={b.h + 20} />
          ))}
        </g>
        {blocks(FAR.blocks, "--far", 0.1)}
        <g style={stroke("--far")} fill="none" strokeWidth="1.2">
          {MASTS.map((m, i) => (
            <path key={i} d={`M${m.x} ${m.y + 18}v-18M${m.x - 3} ${m.y + 12}h6`} />
          ))}
          <path d={`M776 236V60M782 236V60${LATTICE}`} />
          <path d="M700 60h196M700 66h196M779 60l-70 0M779 44l-73 16M779 44l95 16M779 60V40" />
          <path d="M858 66v46" strokeWidth=".6" />
        </g>
        <g style={fill("--far")}>
          <rect x="704" y="66" width="18" height="9" />
          <path d="M854 112h8l-2 5h-4z" />
        </g>
        <g>{windows(FAR.wins)}</g>
        <rect y="150" width="1200" height="86" fill="url(#hs-mist)" />
        {tower("M300 236V52l22 -14l22 14V236z", 300, 44)}
        <path d="M322 38V6" style={stroke("--tower")} strokeWidth="1.6" />
        {tower("M600 236V100l52 -14V236z", 600, 52)}
        {tower("M920 236V96h6v-14h28v14h6V236z", 920, 40)}
        <g style={{ opacity: "calc(.25 + var(--night) * .75)" }}>
          {LIGHTS.map((m, i) => (
            <g key={i} className="hs-blink" style={{ animationDelay: `${m.delay.toFixed(2)}s` }}>
              <circle cx={m.x} cy={m.y} r="6" fill="url(#hs-red)" />
              <circle cx={m.x} cy={m.y} r="1.4" fill="#ff5a4d" />
            </g>
          ))}
        </g>
        {blocks(NEAR.blocks, "--near", 0.16)}
        <g style={fill("--near")}>
          {TANKS.map((t, i) => (
            <path key={i} d={`M${t.x} ${t.y}v-6h1v6zM${t.x + 9} ${t.y}v-6h1v6zM${t.x - 1} ${t.y - 6}h12v-9h-12zM${t.x - 2} ${t.y - 15}l7 -5l7 5z`} />
          ))}
        </g>
        <g>{windows(NEAR.wins)}</g>

        {/* Weather outside the glass: fog over the city, rain or snow falling in two layers (the far one smaller). */}
        {(kind === "fog" || wet || kind === "snow") && (
          <rect y="-60" width="1200" height="282" fill="url(#hs-fog)" opacity={kind === "fog" ? 1 : 0.45} />
        )}
        {kind === "fog" && (
          <g className="hs-fogband" style={{ opacity: 0.5 }}>
            {WRAP.map((dx) =>
              [
                [150, 150, 260],
                [620, 120, 300],
                [1050, 170, 240],
              ].map(([x, y, rx], i) => <ellipse key={`${dx}-${i}`} cx={x + dx} cy={y} rx={rx} ry="26" fill="url(#hs-puff)" />),
            )}
          </g>
        )}
        {(wet || kind === "snow") && (
          <g clipPath="url(#hs-wall)" opacity={kind === "storm" ? 0.75 : kind === "rain" ? 0.55 : 0.85}>
            {(
              [
                ["translate(11 7) scale(.6)", "b", 0.5],
                ["", "a", 1],
              ] as const
            ).map(([t, layer, o]) => (
              <g key={layer} transform={t} opacity={o}>
                <g className={wet ? `hs-rain-${layer}` : `hs-snow-${layer}`}>
                  <rect x="-10" y="-460" width="2100" height="1100" fill={wet ? "url(#hs-rain)" : "url(#hs-snow)"} />
                </g>
              </g>
            ))}
          </g>
        )}

        {/* The glass: a faint tint, the sun's sheen by day, the office's lights mirrored at night. */}
        <rect y="-116" width="1200" height="338" fill="#8fc3d6" opacity=".07" />
        {wet && (
          <g fill="#e4f0fb">
            {DROPS.map((d, i) => (
              <g key={i} opacity=".32">
                <ellipse cx={d.x} cy={d.y} rx={d.r} ry={d.r * 1.25} />
                <circle cx={d.x - d.r * 0.35} cy={d.y - d.r * 0.4} r={d.r * 0.35} opacity=".9" />
              </g>
            ))}
            {TRICKLES.map(([x, y, delay], i) => (
              <g key={i} className="hs-trickle" style={{ animationDelay: `${delay}s` }}>
                <path d={`M${x} ${y - 26}q1 13 0 24`} stroke="#e4f0fb" strokeWidth="1" fill="none" opacity=".22" />
                <ellipse cx={x} cy={y} rx="2" ry="2.6" opacity=".45" />
              </g>
            ))}
          </g>
        )}
        <g fill="url(#hs-sheen)" style={byDay(0.8)}>
          <polygon points="120,-116 220,-116 60,222 -40,222" />
          <polygon points="560,-116 600,-116 480,222 440,222" />
          <polygon points="1000,-116 1070,-116 950,222 880,222" />
        </g>
        <g style={atNight(0.3)} fill="#fff6e6">
          {PANELS.map((x) => (
            <g key={x}>
              <rect x={x + 6} y="-88" width="78" height="2" rx="1" />
              <ellipse cx={x + 45} cy="-87" rx="70" ry="10" fill="url(#hs-panel)" />
            </g>
          ))}
        </g>

        {/* Blinds pulled part way down two panes. */}
        {(
          [
            [203.5, 436.5, -30],
            [923.5, 1156.5, -72],
          ] as const
        ).map(([x0, x1, y], i) => (
          <g key={i}>
            <rect x={x0} y="-116" width={x1 - x0} height={y + 116} style={fill("--blind")} opacity=".92" />
            <path d={Array.from({ length: Math.floor((y + 116) / 5) }, (_, j) => `M${x0} ${-112 + j * 5}h${x1 - x0}`).join("")} stroke="#000" strokeWidth=".5" opacity=".1" />
            <rect x={x0} y={y - 3} width={x1 - x0} height="3" style={fill("--frame")} />
            <path d={`M${x1 - 14} ${y}v34`} style={stroke("--frame")} strokeWidth=".8" />
            <circle cx={x1 - 14} cy={y + 35} r="1.4" style={fill("--frame")} />
          </g>
        ))}

        {/* The office: ceiling with light panels, the window frame, and the ledge under the glass. */}
        <rect y="-150" width="1200" height="34" style={fill("--ceil")} />
        <path d={Array.from({ length: 20 }, (_, i) => `M${i * 60} -150v26`).join("") + "M0 -124h1200"} stroke="#000" strokeWidth=".8" opacity=".2" />
        {PANELS.map((x) => (
          <g key={x}>
            <ellipse cx={x + 45} cy="-124" rx="90" ry="14" fill="url(#hs-panel)" style={atNight(0.8)} />
            <rect x={x} y="-131" width="90" height="4" rx="1" fill="#f4f7ff" style={{ opacity: "calc(.55 + var(--night) * .45)" }} />
          </g>
        ))}
        <rect y="-122" width="1200" height="7" style={fill("--frame")} />
        <path d="M0 -115.5h1200" style={stroke("--sill")} strokeWidth="1" opacity=".4" />
        <g style={fill("--frame")}>
          {MULLIONS.map((x) => (
            <rect key={x} x={x - 3.5} y="-116" width="7" height="338" />
          ))}
        </g>
        <path d={MULLIONS.map((x) => `M${x - 2} -116v338`).join("")} style={stroke("--sill")} strokeWidth="1" opacity=".3" />
        <rect y="222" width="1200" height="78" style={fill("--wall")} />
        <rect y="219" width="1200" height="5" style={fill("--sill")} />
        <path d={Array.from({ length: 5 }, (_, i) => `M40 ${234 + i * 4}h1120`).join("")} stroke="#000" strokeWidth="1.4" opacity=".22" />

        {/* A snake plant in a white planter on the ledge. */}
        <g>
          {SNAKE.map(([x, h, lean], i) => {
            const d = `M${x - 4} 194C${x - 5} ${194 + h * 0.5} ${x + lean - 2} ${194 + h * 0.85} ${x + lean} ${194 + h}C${x + lean + 2} ${194 + h * 0.85} ${x + 5} ${194 + h * 0.5} ${x + 4} 194z`;
            return <path key={i} d={d} style={{ ...fill("--leaf"), ...stroke("--leaf-hi") }} strokeWidth=".9" />;
          })}
          <path d="M540 219l4 -27h44l4 27z" style={fill("--planter")} />
          <rect x="541" y="190" width="50" height="4" rx="1.5" style={fill("--planter")} />
          <path d="M546 194l-3 25" style={stroke("--fg")} strokeWidth="2" opacity=".15" />
        </g>

        {/* Up close, bottom right (hs-front scales it up): the desk, a monitor showing a calendar, a laptop, and the rest. */}
        <g className="hs-front">
          <g style={{ opacity: "calc(.2 + var(--night) * .8)" }}>
            <ellipse className="hs-screen" cx="925" cy="188" rx="58" ry="40" fill="url(#hs-screen)" />
            <ellipse className="hs-screen" cx="1073" cy="170" rx="80" ry="56" fill="url(#hs-screen)" style={{ animationDelay: "2s" }} />
          </g>

          {/* Desk: a wooden top with a lit front edge, grain, light from the screens, and metal legs. */}
          <rect x="850" y="214" width="300" height="9" rx="2" fill="url(#hs-wood)" />
          <path d="M851 214.6h298" style={stroke("--wood-hi")} strokeWidth="1" opacity=".7" />
          <path d="M856 218.4c40 -.7 80 .6 120 0s90 -.7 168 .2M860 220.6c50 .5 96 -.6 140 0s80 .5 140 -.3" style={stroke("--wood")} strokeWidth=".5" fill="none" opacity=".8" />
          <ellipse cx="925" cy="214.4" rx="48" ry="2.6" fill="#9fd0ff" style={atNight(0.35)} />
          <ellipse cx="1073" cy="214.4" rx="60" ry="2.8" fill="#9fd0ff" style={atNight(0.3)} />
          <g fill="url(#hs-metal)">
            <rect x="866" y="223" width="6" height="95" />
            <rect x="1127" y="223" width="6" height="95" />
          </g>
          <g fill="#000" opacity=".28">
            <ellipse cx="925" cy="214.3" rx="38" ry="1.6" />
            <ellipse cx="994" cy="214.3" rx="10" ry="1.2" />
            <ellipse cx="1073" cy="214.3" rx="18" ry="1.3" />
            <ellipse cx="1136" cy="214.3" rx="14" ry="1.2" />
            <ellipse cx="868" cy="214.3" rx="8" ry="1.1" />
          </g>

          {/* A cup of pencils. */}
          <g strokeLinecap="round">
            <path d="M864 200l-5 -15M868 200l1 -17M871 200l5 -14" stroke="#d9a441" strokeWidth="2" style={{ opacity: "calc(1 - var(--night) * .6)" }} />
            <path d="M859 185l-.6 -1.8M869 183v-1.8M876 186l.7 -1.7" style={stroke("--fg")} strokeWidth="2" />
          </g>
          <path d="M861 199h14l-1 15h-12z" fill="url(#hs-metal)" />

          {/* Headphones. */}
          <path d="M964 213.4a8 6 0 0 1 16 0" fill="none" style={stroke("--bezel")} strokeWidth="1.8" />
          <g style={fill("--bezel")}>
            <rect x="962" y="210.5" width="4.5" height="3.5" rx="1.2" />
            <rect x="977.5" y="210.5" width="4.5" height="3.5" rx="1.2" />
          </g>

          {/* Mug, with steam. */}
          <g transform="translate(-68 0)">
            <path d="M1070 200c8 0 8 11 0 11" fill="none" style={stroke("--mug-lo")} strokeWidth="3" />
            <path d="M1054 196h16v15c0 2 -2 3 -4 3h-8c-2 0 -4 -1 -4 -3z" fill="url(#hs-mug)" />
            <ellipse cx="1062" cy="196" rx="8" ry="1.8" style={fill("--mug-lo")} />
            <ellipse cx="1062" cy="196.4" rx="6.4" ry="1.2" fill="#4a2c1c" />
            <path d="M1056.5 199v10" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" opacity=".35" />
            <g fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round">
              <path className="hs-steam" d="M1059 192c-4 -6 4 -10 0 -16" />
              <path className="hs-steam" style={{ animationDelay: "1.6s" }} d="M1066 192c-4 -6 4 -10 0 -16" />
            </g>
          </g>

          {/* Monitor on a stand, showing a week of calendar, a sticky note, and an ID badge hung on its corner. */}
          <rect x="1070" y="197" width="6" height="13" fill="url(#hs-metal)" />
          <path d="M1058 214l4 -4h22l4 4z" fill="url(#hs-metal)" />
          <rect x="1026" y="138" width="94" height="60" rx="2" style={fill("--bezel")} />
          <rect x="1029" y="141" width="88" height="53" fill="url(#hs-monitor)" />
          <rect x="1029" y="141" width="88" height="6" fill="#2b2f3a" opacity=".85" />
          <path d={Array.from({ length: 4 }, (_, i) => `M${1046.6 + i * 17.6} 147v47`).join("") + "M1029 158h88M1029 170h88M1029 182h88"} stroke="#000" strokeWidth=".35" opacity=".18" />
          <g opacity=".9">
            <rect x="1030.5" y="150" width="14.5" height="9" rx="1" fill="#f07b3f" />
            <rect x="1048" y="161" width="14.5" height="13" rx="1" fill="#5b8def" />
            <rect x="1065.5" y="149" width="14.5" height="7" rx="1" fill="#46b38a" />
            <rect x="1083" y="166" width="14.5" height="10" rx="1" fill="#f07b3f" />
            <rect x="1100.5" y="152" width="14.5" height="14" rx="1" fill="#a678e8" />
            <rect x="1030.5" y="176" width="14.5" height="8" rx="1" fill="#5b8def" />
            <rect x="1065.5" y="180" width="14.5" height="9" rx="1" fill="#f0b93f" />
          </g>
          <polygon points="1029,141 1060,141 1040,194 1029,194" fill="#fff" opacity=".1" />
          <rect x="1110" y="184" width="8" height="8" fill="#f6d55c" transform="rotate(6 1114 188)" />
          <path d="M1031 142c-6 10 -9 22 -8 34M1036 142c-2 12 -6 24 -13 34" fill="none" stroke="#3f63c9" strokeWidth=".9" />
          <rect x="1018" y="175" width="10" height="13" rx="1" fill="#f4f4f6" />
          <rect x="1018" y="175" width="10" height="3.5" rx="1" fill="#3f63c9" />
          <circle cx="1023" cy="182.5" r="2" fill="#c9ccd3" />

          {/* Keyboard and mouse. */}
          <rect x="1030" y="210.6" width="70" height="3.2" rx="1" style={fill("--bezel")} />
          <path d="M1033 211.8h64" style={stroke("--metal-hi")} strokeWidth=".6" strokeDasharray="2.4 1.2" opacity=".5" />
          <ellipse cx="1110" cy="212.6" rx="4.5" ry="1.8" style={fill("--bezel")} />

          {/* Books with a succulent on top. */}
          {(
            [
              [1124, 208, 26, 6, "--book1"],
              [1126, 203, 22, 5, "--book2"],
              [1123, 199, 25, 4, "--book3"],
            ] as const
          ).map(([x, y, w, h, c], i) => (
            <g key={i}>
              <rect x={x} y={y} width={w} height={h} rx=".8" style={fill(c)} />
              <rect x={x + 3} y={y + 1} width={w - 3} height={h - 2} style={fill("--mug")} />
            </g>
          ))}
          <path d="M1130 199l1 -7h10l1 7z" style={fill("--planter")} />
          <g style={fill("--leaf")}>
            <ellipse cx="1133" cy="190" rx="2.6" ry="4.5" transform="rotate(-30 1133 190)" />
            <ellipse cx="1136" cy="188.5" rx="2.6" ry="5" />
            <ellipse cx="1139" cy="190" rx="2.6" ry="4.5" transform="rotate(30 1139 190)" />
          </g>

          {/* Laptop: aluminium deck and lid, and the screen showing a document. */}
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
      {/* The greeting: at the top on phones (the desk is lower down there), at the bottom on wide screens. */}
      <h1 className="absolute top-4 left-4 font-serif text-2xl text-white [text-shadow:0_2px_18px_rgb(0_0_0/0.45)] lg:top-auto lg:bottom-16 lg:left-6 lg:text-4xl">
        {greeting}
      </h1>
    </div>
  );
}
