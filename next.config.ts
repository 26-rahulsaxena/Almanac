import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Which version this is (the GitHub commit Vercel built). An open page, like the Android app kept running in the
  // background, compares it with /api/version and reloads when a newer one is live.
  env: { ALMANAC_BUILD: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
