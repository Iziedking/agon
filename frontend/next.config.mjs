/** @type {import('next').NextConfig} */
const nextConfig = {
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
