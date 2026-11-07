import path from "path";
import { fileURLToPath } from "url";
const root = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@anthropic-ai/sdk", "openai", "node:sqlite"],
  webpack: (config, { isServer, nextRuntime }) => {
    config.resolve.alias = { ...config.resolve.alias, "@": root, accounts: false };
    if (!isServer || nextRuntime === "edge") {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
        dns: false,
        net: false,
        fs: false,
        path: false,
        "pino-pretty": false,
        lokijs: false,
        encoding: false,
      };
    } else {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        "pino-pretty": false,
        lokijs: false,
        encoding: false,
      };
    }
    return config;
  },
};
export default nextConfig;
