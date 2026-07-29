/* ============================================================================
   End-to-end sign-in: register → cookie → ticket → socket

   THIS IS THE TEST THAT WAS MISSING.

   Every component of auth was individually verified and the seam between them
   was not. `identify()` worked, the session table worked, CORS was configured
   correctly, the client set `withCredentials` — and the flow still did not work
   in a browser, because nothing exercised the join between them. Same shape as
   the `--ulimit nproc` trap and the lone-surrogate exploit: correct parts,
   broken seam, invisible without running the real thing.

   So this drives real HTTP against the running dev server, keeps a cookie jar
   exactly as a browser would, and finishes by opening a real socket to the
   gateway. It deliberately uses the SAME endpoints the form posts to — a test
   that hits a different entry point than the UI can pass while the UI is broken,
   which is precisely how this got missed.

   Requires: dev server on :3000, gateway on :4000, Postgres, Redis.
   Run with:  pnpm --filter @1v1/gateway test:signin
   ========================================================================= */

import assert from "node:assert/strict";
import test, { after, before, describe } from "node:test";
import { io, type Socket } from "socket.io-client";

const WEB = process.env["WEB_URL"] ?? "http://localhost:3000";
const GATEWAY = process.env["GATEWAY_URL"] ?? "http://localhost:4000";

/** Minimal cookie jar: stores what Set-Cookie gives us and replays it. */
class Jar {
  private cookies = new Map<string, string>();

  absorb(response: Response): void {
    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const eq = pair?.indexOf("=") ?? -1;
      if (!pair || eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === "" || /Max-Age=0/i.test(raw)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }
}

interface Posted {
  status: number;
  /** Body read exactly once — a Response body cannot be consumed twice, and
   *  passing `await response.text()` as an assert message consumes it eagerly
   *  even when the assertion passes. */
  text: string;
  json: <T>() => T;
}

async function post(path: string, jar: Jar, body?: unknown): Promise<Posted> {
  const response = await fetch(`${WEB}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(jar.header() ? { Cookie: jar.header() } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  jar.absorb(response);
  const text = await response.text();
  return {
    status: response.status,
    text,
    json: <T,>() => JSON.parse(text) as T,
  };
}

function connect(auth: Record<string, unknown>, cookie?: string): Promise<Socket | Error> {
  return new Promise((resolve) => {
    const socket = io(GATEWAY, {
      transports: ["websocket"],
      reconnection: false,
      auth,
      ...(cookie ? { extraHeaders: { Cookie: cookie } } : {}),
    });
    const timer = setTimeout(() => {
      socket.close();
      resolve(new Error("timed out"));
    }, 10_000);
    socket.on("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on("connect_error", (error) => {
      clearTimeout(timer);
      socket.close();
      resolve(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

const unique = Date.now().toString(36).slice(-6);
const account = {
  handle: `sig_${unique}`,
  email: `signin-${unique}@example.com`,
  password: "correct-horse-battery-staple",
};

before(async () => {
  const health = await fetch(`${WEB}/login`).catch(() => null);
  if (!health?.ok) throw new Error(`dev server not reachable at ${WEB}`);
});

describe("sign-in path, end to end", () => {
  const jar = new Jar();

  test("registration issues a session cookie", async () => {
    const response = await post("/api/auth/register", jar, account);
    assert.equal(response.status, 200, response.text);
    assert.ok(
      jar.get("1v1_session"),
      "no 1v1_session cookie was set — the browser would have nothing to send",
    );
  });

  test("a duplicate registration is refused without clobbering the session", async () => {
    const response = await post("/api/auth/register", new Jar(), account);
    assert.equal(response.status, 400);
    assert.ok(jar.get("1v1_session"), "the original session must survive");
  });

  test("the cookie mints a socket ticket from the app's own origin", async () => {
    // The step that fixes the cross-origin problem: this request is same-origin,
    // so the cookie is unambiguously sent.
    const response = await post("/api/socket-ticket", jar);
    assert.equal(response.status, 200, response.text);
    const data = response.json<{ ticket: string; handle: string }>();
    assert.ok(data.ticket && data.ticket.length > 20, "ticket must be substantial");
    assert.equal(data.handle, account.handle, "ticket must belong to the right user");
  });

  test("no cookie means no ticket", async () => {
    const response = await post("/api/socket-ticket", new Jar());
    assert.equal(response.status, 401, "an anonymous caller must not get a ticket");
  });

  test("THE SEAM: a freshly minted ticket authenticates a real socket", async () => {
    const ticketResponse = await post("/api/socket-ticket", jar);
    const { ticket } = ticketResponse.json<{ ticket: string }>();

    const result = await connect({ ticket });
    assert.ok(
      !(result instanceof Error),
      `socket refused a valid ticket: ${result instanceof Error ? result.message : ""}`,
    );
    (result as Socket).close();
  });

  test("a ticket is single use — replay is refused", async () => {
    const ticketResponse = await post("/api/socket-ticket", jar);
    const { ticket } = ticketResponse.json<{ ticket: string }>();

    const first = await connect({ ticket });
    assert.ok(!(first instanceof Error), "first use must succeed");
    (first as Socket).close();

    const second = await connect({ ticket });
    assert.ok(second instanceof Error, "a replayed ticket must be refused");
  });

  test("a forged ticket is refused", async () => {
    const result = await connect({ ticket: "not-a-real-ticket-at-all" });
    assert.ok(result instanceof Error, "forged ticket must be refused");
    assert.match((result as Error).message, /unauthenticated/i);
  });

  test("no credentials at all is refused", async () => {
    const result = await connect({});
    assert.ok(result instanceof Error, "anonymous socket must be refused");
  });

  test("the cookie fallback still authenticates a socket directly", async () => {
    // Kept working so the headless probes and any same-origin deployment do not
    // regress when the ticket path is the primary one.
    const result = await connect({}, `1v1_session=${jar.get("1v1_session")}`);
    assert.ok(
      !(result instanceof Error),
      `cookie fallback broke: ${result instanceof Error ? result.message : ""}`,
    );
    (result as Socket).close();
  });

  test("logout revokes the session everywhere", async () => {
    const response = await post("/api/auth/logout", jar);
    assert.equal(response.status, 200);
    const after = await post("/api/socket-ticket", jar);
    assert.equal(after.status, 401, "a logged-out session must not mint tickets");
  });

  test("login re-issues a working session", async () => {
    const fresh = new Jar();
    const response = await post("/api/auth/login", fresh, {
      email: account.email,
      password: account.password,
    });
    assert.equal(response.status, 200, response.text);
    assert.ok(fresh.get("1v1_session"), "login must set a cookie");

    const ticketResponse = await post("/api/socket-ticket", fresh);
    assert.equal(ticketResponse.status, 200);
    const { ticket } = ticketResponse.json<{ ticket: string }>();
    const result = await connect({ ticket });
    assert.ok(!(result instanceof Error), "login → ticket → socket must work");
    (result as Socket).close();
  });

  test("a wrong password is refused and sets no cookie", async () => {
    const fresh = new Jar();
    const response = await post("/api/auth/login", fresh, {
      email: account.email,
      password: "wrong-password-entirely",
    });
    assert.equal(response.status, 401);
    assert.equal(fresh.get("1v1_session"), undefined, "a failed login must not set a cookie");
  });
});

after(async () => {
  // Leave the database as we found it.
  const { prisma } = await import("@1v1/db");
  await prisma.user.deleteMany({ where: { email: account.email } });
  await prisma.$disconnect();
});
