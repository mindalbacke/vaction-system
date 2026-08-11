import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

if (process.env.NODE_ENV === "development") {
  initOpenNextCloudflareForDev();
}

const nextConfig: NextConfig = {
  output: "standalone",
  typedRoutes: true,
  experimental: {
    optimizePackageImports: ["date-fns", "lucide-react"],
  },
};

export default nextConfig;
