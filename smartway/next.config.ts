import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["tesseract.js"],
  outputFileTracingIncludes: {
    "/api/maps": ["./node_modules/@tesseract.js-data/por/4.0.0/*"],
  },
};

export default nextConfig;
