import { ImageResponse } from "next/og";

// App icon in two sizes (/icon/small, /icon/large) for the install prompt and notifications.
export function generateImageMetadata() {
  return [
    { id: "small", size: { width: 192, height: 192 }, contentType: "image/png" },
    { id: "large", size: { width: 512, height: 512 }, contentType: "image/png" },
  ];
}

export default async function Icon({ id }: { id: Promise<string> }) {
  const s = (await id) === "small" ? 192 : 512;
  return new ImageResponse(<Mark size={s} />, { width: s, height: s });
}

// Ink square, a paper "A", and the vermilion "now" line.
export function Mark({ size }: { size: number }) {
  return (
    <div style={{ width: size, height: size, background: "#1d1b18", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
      <span style={{ color: "#f4f1ea", fontSize: size * 0.62, fontWeight: 700, lineHeight: 1, marginTop: -size * 0.04 }}>A</span>
      <div style={{ position: "absolute", left: size * 0.12, right: size * 0.12, top: size * 0.66, height: size * 0.045, background: "#ff6a45", borderRadius: size }} />
      <div style={{ position: "absolute", left: size * 0.08, top: size * 0.645, width: size * 0.09, height: size * 0.09, background: "#ff6a45", borderRadius: size }} />
    </div>
  );
}
