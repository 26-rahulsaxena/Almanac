import { ImageResponse } from "next/og";
import { MARK, markShapes } from "@/lib/mark";

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

// Ink square and the stacked cards with today's dot (the same drawing as the Android app's icon).
export function Mark({ size }: { size: number }) {
  return (
    <div style={{ width: size, height: size, background: MARK.ink, display: "flex" }}>
      {/* A margin, so phones that round or crop the icon don't cut off the cards' corners. */}
      <svg width={size} height={size} viewBox="-10 -10 120 120">
        {markShapes()}
      </svg>
    </div>
  );
}
