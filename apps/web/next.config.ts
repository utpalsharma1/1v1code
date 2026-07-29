import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,

  /* `next build` and `next dev` must not share an output directory.

     They did, and it cost a whole browser-verification session. A production
     build run while the dev server is up replaces the chunks and the asset
     manifest that the running dev process is still serving from memory, so the
     dev server keeps returning 200 for every route while every `/_next/static/*`
     asset it references 404s. The app then renders as unstyled HTML with a dead
     React runtime — and nothing reports an error, because from the server's
     point of view every page was served successfully.

     The build script sets NEXT_DIST_DIR, so the two can never collide again. */
  distDir: process.env["NEXT_DIST_DIR"] ?? ".next",
  // @1v1/ui ships TypeScript source rather than a build artifact, so there is
  // one compiler and one set of tokens across the monorepo.
  transpilePackages: ["@1v1/ui", "@1v1/db", "@1v1/proto", "@1v1/core"],
};

export default config;
