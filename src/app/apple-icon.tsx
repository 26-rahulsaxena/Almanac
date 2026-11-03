import { ImageResponse } from "next/og";
import { Mark } from "./icon";

// Home Screen icon on iPhone/iPad.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<Mark size={180} />, size);
}
