import type { NextConfig } from "next";

const ADMIN_LOGIN_PATH =
  process.env.ADMIN_LOGIN_PATH?.trim() || "/private-admin-login";

const nextConfig: NextConfig = {
  output: "standalone",
  // sharp 有原生依赖链（libvips.mjs 依赖 semver），standalone 追踪易漏导致
  // 运行时 "Cannot find package 'semver'"。标记 external 让其运行时从 node_modules 加载。
  serverExternalPackages: ["sharp"],
  async rewrites() {
    return [
      {
        source: ADMIN_LOGIN_PATH,
        destination: "/login",
      },
    ];
  },
};

export default nextConfig;
