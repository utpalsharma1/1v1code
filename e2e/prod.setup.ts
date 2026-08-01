/* ============================================================================
   Global setup for the PRODUCTION configuration.

   Builds the web app, starts it with `next start`, and puts Caddy in front —
   the same single-origin topology `pnpm tunnel` and Stage 1 use. The specs are
   the ordinary ones; only the configuration under them changes.

   FOUR BUGS SHIPPED PAST A GREEN SUITE because e2e only ever ran against
   `next dev` on localhost:3000, which is a configuration nobody uses:

     the RSC seam           a server action unreachable from a test
     the asset collision    dev server and build sharing .next
     the stale server       a rebuild landing under a running process
     the missing env        a production server started with no DATABASE_URL

   The last one is why this file goes further than a different baseURL. It was
   not a wrong configuration, it was a wrong INVOCATION: the script was only
   ever run from a shell that had already sourced `.env`. So the child processes
   here are started with an EXPLICIT environment rather than an inherited one —
   `env -i` in spirit — and anything the app needs has to be passed on purpose.
   If a variable is missing, this fails here rather than in a route handler.
   ========================================================================= */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/* __dirname, not import.meta: Playwright loads globalSetup through a CommonJS
   path, where import.meta is a syntax error. */
const ROOT = join(__dirname, "..");
const WEB_PORT = 3101;
const PROXY_PORT = 8180;

/** Everything the production web server needs, named rather than inherited. */
const REQUIRED = ["DATABASE_URL", "REDIS_URL", "SESSION_SECRET"] as const;

/** Reads .env the way the scripts do, without polluting this process. */
function dotenv(): Record<string, string> {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

let web: ChildProcess | undefined;
let proxy: ChildProcess | undefined;

async function waitFor(url: string, what: string, tries = 60): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const response = await fetch(url);
      if (response.status > 0) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${what} never came up at ${url}`);
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const file = dotenv();

  /* THE EXPLICIT ENVIRONMENT. Not `...process.env`: the point is that a
     variable reaches the child because it was named here, so a missing one is
     a failure of this list rather than a property of whoever's shell launched
     the suite. */
  const env: Record<string, string> = {
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    HOME: process.env["HOME"] ?? "/tmp",
    NODE_ENV: "production",
    /* Empty => same origin => the client derives wss:// from the page. The
       whole single-origin property under test. */
    NEXT_PUBLIC_GATEWAY_URL: "",
    /* Caddy is the proxy here, not Cloudflare, so the header path under test
       is the one that would ship behind our own reverse proxy. */
    TRUSTED_PROXY: "local",
    WEB_ORIGIN: `http://localhost:${PROXY_PORT}`,
  };
  const missing: string[] = [];
  for (const name of REQUIRED) {
    const value = process.env[name] ?? file[name];
    if (value === undefined || value.trim() === "") missing.push(name);
    else env[name] = value;
  }
  if (missing.length > 0) {
    throw new Error(
      `production e2e cannot start: missing ${missing.join(", ")}. ` +
        "Expected in .env at the repo root.",
    );
  }

  console.log("[prod-e2e] building…");
  const built = spawnSync("pnpm", ["--filter", "@1v1/web", "build"], {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });
  if (built.status !== 0) throw new Error("production build failed");

  console.log(`[prod-e2e] starting next start on :${WEB_PORT}`);
  web = spawn("pnpm", ["--filter", "@1v1/web", "start", "-p", String(WEB_PORT)], {
    cwd: ROOT,
    env,
    stdio: "inherit",
    detached: true,
  });
  await waitFor(`http://localhost:${WEB_PORT}/`, "production web");

  console.log(`[prod-e2e] starting Caddy on :${PROXY_PORT}`);
  proxy = spawn("caddy", ["run", "--config", join(ROOT, "e2e", "Caddyfile.e2e"), "--adapter", "caddyfile"], {
    cwd: ROOT,
    env: { ...env, WEB_PORT: String(WEB_PORT), PROXY_PORT: String(PROXY_PORT) },
    stdio: "inherit",
    detached: true,
  });
  await waitFor(`http://localhost:${PROXY_PORT}/`, "caddy");

  return async () => {
    for (const child of [proxy, web]) {
      if (child?.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  };
}
