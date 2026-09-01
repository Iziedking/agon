/** @type {import('next').NextConfig} */
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  outputFileTracingRoot: projectRoot,
  async redirects() {
    return process.env.NEXT_PUBLIC_PRODUCT_VARIANT === "agon"
      ? [{ source: "/", destination: "/market", permanent: false }]
      : [];
  },
  // Don't fail the production build on lint (e.g. <a> vs <Link>); types are still checked.
  eslint: { ignoreDuringBuilds: true },
  webpack: (config) => {
    // wagmi's connector barrel pulls in @metamask/sdk, which optionally imports
    // React Native and Node-only modules that do not exist in a web build.
    // Stub them so the bundle resolves cleanly.
    config.resolve.fallback = {
      ...config.resolve.fallback,
      "@react-native-async-storage/async-storage": false,
    };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};

export default nextConfig;
