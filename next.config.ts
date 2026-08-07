import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev-only overlay badge (route/bundler info). It never shows in production anyway,
  // just turning it off so it doesn't hover over the UI while testing locally.
  devIndicators: false,
};

export default nextConfig;
