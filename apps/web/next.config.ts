import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // @1v1/ui ships TypeScript source rather than a build artifact, so there is
  // one compiler and one set of tokens across the monorepo.
  transpilePackages: ["@1v1/ui"],
};

export default config;
