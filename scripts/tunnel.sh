#!/usr/bin/env bash
# =============================================================================
#  pnpm tunnel — Stage 0: one public HTTPS URL for the local stack.
#
#  Builds and runs the app in PRODUCTION mode, puts Caddy in front of the web
#  app and the gateway so they share one origin, and points a Cloudflare quick
#  tunnel at Caddy.
#
#  PRODUCTION MODE IS NOT AN OPTION HERE. `/dev/sparring` mints socket tickets
#  and `/dev/*` only 404s under NODE_ENV=production, so a dev-mode server behind
#  a public URL hands anyone holding it a second identity in your matches. Caddy
#  also refuses /dev/* at the edge; that is the second lock, not the first.
#
#  DOES A RESTART NEED A REBUILD? No, and that is verifiable rather than
#  asserted: `grep -r trycloudflare apps/web/.next-build` finds nothing, and so
#  does a grep for localhost:4000. The bundle contains no hostname at all
#  because every deployed environment reaches the gateway through its own
#  origin. A new tunnel hostname therefore needs no rebuild for correctness.
#
#  This script rebuilds anyway, because it is also the thing you run after
#  changing code and a stale build is the more likely mistake. What it must
#  never do is rebuild UNDERNEATH a running server — see free_port below.
#
#  #  THE URL IS FOR PEOPLE YOU KNOW. A quick tunnel has no access control, and the
#  judge is running untrusted code on this machine rather than on a disposable
#  VPS. Share it with a friend; do not post it.
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$PATH"

# SOURCE .env, THE WAY up.sh DOES.
#
# This script did not, and `pnpm stack` did (scripts/up.sh). So the gateway got
# a DATABASE_URL and the production web server did not, and the difference was
# invisible: every GET works without a database, so the landing page, the
# assets and the socket.io handshake all passed while the first route that
# touches Postgres — registration — returned a 500 with an EMPTY BODY.
#
# `next start` runs from apps/web and Next only auto-loads .env from the
# application directory, so the repo-root .env it needs was never read.
#
# It was invisible to me for a second reason worth writing down: I had always
# run `set -a; . ./.env; set +a` in the same shell before invoking this script,
# so my testing inherited the variables the script fails to load. The check
# passed for me and failed for the person running it cleanly, which is the
# worst possible split.
set -a
[ -f .env ] && . ./.env
set +a

RESET=$'\e[0m'; DIM=$'\e[2m'; GREEN=$'\e[32m'; RED=$'\e[31m'; YELLOW=$'\e[33m'; BOLD=$'\e[1m'
ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
bad()  { printf '  %s✗%s %s\n' "$RED" "$RESET" "$1"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$1"; }
head_(){ printf '\n%s%s%s\n' "$BOLD" "$1" "$RESET"; }

. "$(dirname "$0")/lib/check.sh"

RUN_DIR="${TMPDIR:-/tmp}/1v1-tunnel"
mkdir -p "$RUN_DIR"

for tool in caddy cloudflared; do
  command -v "$tool" >/dev/null || { bad "$tool not found on PATH"; exit 1; }
done

# --- self-safe teardown: only kill what this script started ------------------
stop_pid() {
  local name="${1:-}"
  [[ -n "$name" ]] || return 0
  local pidfile="$RUN_DIR/$name.pid"
  [[ -f "$pidfile" ]] || return 0
  local pid; pid=$(cat "$pidfile" 2>/dev/null || echo "")
  if [[ -n "$pid" ]] && [[ -r "/proc/$pid/cmdline" ]] \
     && tr '\0' ' ' < "/proc/$pid/cmdline" | grep -q "$name"; then
    kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
  fi
  rm -f "$pidfile"
}
# THE BUG THIS FILE EXISTED WITH: cleanup said `stop_pid next` while the
# pidfile is written as `web.pid`. The name did not match, so `stop_pid`
# returned silently, the production web server survived every Ctrl-C, and the
# script still printed "tunnel, proxy and web stopped". A teardown that reports
# success without doing anything is how the next run inherits a stale server.
# Kills whatever is listening on a port, by port rather than by pidfile. The
# pidfile answers "did the process I started die"; this answers "is the port
# actually free", which is the question that matters before binding it.
free_port() {
  local port="$1" what="${2:-process}" pid
  pid=$(ss -ltnpH "sport = :$port" 2>/dev/null | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
  [[ -n "${pid:-}" ]] || return 0
  warn "port $port still held by pid $pid ($what) — stopping it"
  kill -TERM "$pid" 2>/dev/null
  for _ in $(seq 20); do
    ss -ltnH "sport = :$port" 2>/dev/null | grep -q . || return 0
    sleep 0.25
  done
  kill -KILL "$pid" 2>/dev/null
  sleep 0.5
}

cleanup() {
  head_ "Stopping"
  stop_pid cloudflared
  stop_pid caddy
  stop_pid web
  # Belt and braces: whatever is still holding :3001 after that is ours to take
  # down, because nothing else in this project uses that port.
  free_port 3001 "production web"
  ok "tunnel, proxy and web stopped"
}
trap cleanup EXIT INT TERM

head_ "Stage 0 — public tunnel"

# --- the gateway must already be up ------------------------------------------
# The gateway is a bare Socket.IO server with no HTTP routes, so any other path
# gets no response at all. Probe the engine.io handshake, which is what
# stack:status does.
code=$(curl -s -o /dev/null --max-time 6 -w '%{http_code}' \
  "http://localhost:4000/socket.io/?EIO=4&transport=polling" 2>/dev/null || true)
[[ "$code" != "200" ]] && { bad "no gateway on :4000 (got ${code:-nothing}) — run 'pnpm stack' first"; exit 1; }
ok "gateway :4000 is up"

# --- a PRODUCTION web build, on its own port ---------------------------------
# Not :3000: that is the dev server, and pointing a public tunnel at a dev
# server publishes /dev/sparring, which mints socket tickets. Building here also
# bakes NEXT_PUBLIC_GATEWAY_URL empty, which is what makes the client use the
# page's own origin and derive wss:// instead of ws://.
# Free :3001 BEFORE the build, not after. The build overwrites .next-build
# underneath any server still running on it, and a Next server whose build
# directory is replaced mid-flight serves HTML referencing chunk hashes that no
# longer exist and 500s with an EMPTY BODY on API routes. Those are exactly the
# two failures reported: "Unexpected end of JSON input" on registration, and
# "a client-side exception has occurred" on the next restart.
free_port 3001 "a previous tunnel run"

# Refuse to build a server that cannot answer. Starting and then 500ing on the
# first database query is strictly worse than not starting: the failure surfaces
# to a player instead of here.
require_env DATABASE_URL REDIS_URL SESSION_SECRET || exit 1

head_ "Production build"
export NODE_ENV=production
export NEXT_PUBLIC_GATEWAY_URL=""
# The web package pins NEXT_DIST_DIR=.next-build in its own build and start
# scripts, already separate from the dev server's .next — so there is nothing
# to override here, and setting it was silently ignored.
if ! pnpm --filter @1v1/web build >"$RUN_DIR/build.log" 2>&1; then
  bad "web build failed — see $RUN_DIR/build.log"; tail -20 "$RUN_DIR/build.log"; exit 1
fi
ok "web built (gateway URL empty => same origin => wss://)"

# No `--`: pnpm passes it through and `next start` reads `-p` as a directory.
setsid pnpm --filter @1v1/web start -p 3001 >"$RUN_DIR/web.log" 2>&1 &
echo $! > "$RUN_DIR/web.pid"
for _ in $(seq 40); do
  [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://localhost:3001/play)" != "000" ]] && break
  sleep 0.5
done
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:3001/play || true)
[[ "$code" == "000" ]] && { bad "production web did not start — see $RUN_DIR/web.log"; exit 1; }

# "SOMETHING ANSWERS" IS NOT "THE THING I STARTED ANSWERS". The previous version
# checked only that :3001 responded, and a stale server from an earlier run
# satisfied that perfectly while serving a build that had been deleted from
# under it. Compare the BUILD_ID the server reports against the one this build
# just wrote: if they differ, we are talking to somebody else's process.
disk_build=$(cat apps/web/.next-build/BUILD_ID 2>/dev/null || echo "")
served_build=$(curl -s --max-time 8 http://localhost:3001/play \
  | grep -oE '"buildId":"[^"]+"' | head -1 | cut -d'"' -f4 || true)
if [[ -z "$served_build" ]]; then
  served_build=$(curl -s --max-time 8 http://localhost:3001/play \
    | grep -oE '/_next/static/[^/]+/_buildManifest' | head -1 | cut -d/ -f4 || true)
fi
if [[ -n "$disk_build" && -n "$served_build" && "$disk_build" != "$served_build" ]]; then
  bad "the server on :3001 is serving build $served_build, but this run built $disk_build"
  bad "that is a stale process — it will 500 with an empty body and break the client"
  exit 1
fi
ok "production web on :3001 (/play -> $code, build ${disk_build:0:8})"
# The control is the TICKET ROUTE, not the page. `/dev/sparring` renders a shell
# in any mode; what makes it harmless in production is that
# /api/dev/sparring-ticket 404s, so the shell can never mint an identity. An
# earlier version of this check probed the page and reported a scary warning
# about a route that was never the risk.
tick=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
  -X POST http://localhost:3001/api/dev/sparring-ticket || true)
[[ "$tick" == "404" ]] && ok "dev ticket route 404s (production build) — the shell cannot mint an identity" \
  || bad "dev ticket route returned $tick, expected 404 — is this really a production build?"

# --- Caddy: one origin in front of both --------------------------------------
head_ "Reverse proxy"
setsid caddy run --config deploy/Caddyfile.stage0 >"$RUN_DIR/caddy.log" 2>&1 &
echo $! > "$RUN_DIR/caddy.pid"
for _ in $(seq 20); do
  [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://localhost:8080/play)" != "000" ]] && break
  sleep 0.3
done
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 http://localhost:8080/play || true)
[[ "$code" == "000" ]] && { bad "Caddy did not come up — see $RUN_DIR/caddy.log"; exit 1; }
ok "Caddy on :8080  (/play -> $code)"
dev=$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 http://localhost:8080/dev/sparring || true)
[[ "$dev" == "404" ]] && ok "/dev/* refused at the edge (404)" || bad "/dev/sparring returned $dev, expected 404"

# --- the tunnel ---------------------------------------------------------------
head_ "Cloudflare quick tunnel"
setsid cloudflared tunnel --url http://localhost:8080 --no-autoupdate \
  >"$RUN_DIR/cloudflared.log" 2>&1 &
echo $! > "$RUN_DIR/cloudflared.pid"

URL=""
for _ in $(seq 60); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$RUN_DIR/cloudflared.log" 2>/dev/null | head -1)
  [[ -n "$URL" ]] && break
  sleep 0.5
done
[[ -z "$URL" ]] && { bad "no tunnel URL after 30s — see $RUN_DIR/cloudflared.log"; exit 1; }
ok "tunnel up"

# Verify over IPv4 explicitly. *.trycloudflare.com resolves AAAA-first, and a
# host without an IPv6 route (this WSL2 box) then reports the public URL as
# dead when it is fine for everyone else — an "absence trivially true" result of
# exactly the kind that has bitten this project before. Resolve the A record
# over DoH and pin it, so the check tests the tunnel rather than local IPv6.
host="${URL#https://}"

# LET CURL DO THE DNS. `--doh-url` makes curl resolve over DNS-over-HTTPS
# itself, and combined with `-4` it picks the A record — which is the whole
# problem, because *.trycloudflare.com resolves AAAA-first and this WSL2 box has
# no IPv6 route. The previous version hand-rolled the DoH query, parsed the JSON
# with grep, and then pinned the result with --resolve. That worked when it
# worked and produced a FALSE ALARM when the brand-new hostname had not
# propagated within its retry budget: the pre-flight refused to print a URL that
# was fine. A checker that cries wolf is one that gets ignored, which is the
# lesson from db:samples being stricter than the judge.
#
# Retry anyway, because a hostname seconds old genuinely may not resolve yet —
# but retry the REAL REQUEST rather than a proxy for it.
CURL4=(curl -4 -s --doh-url https://cloudflare-dns.com/dns-query)
public_ready=0
for _ in $(seq 20); do
  if [[ "$("${CURL4[@]}" -o /dev/null -m 10 -w '%{http_code}' "$URL/" || true)" == "200" ]]; then
    public_ready=1
    break
  fi
  sleep 3
done

if [[ "$public_ready" == "1" ]]; then
  code="000"
  for _ in 1 2 3; do
    code=$("${CURL4[@]}" -o /dev/null -m 25 -w '%{http_code}' "$URL/play" || true)
    [[ "$code" == "200" ]] && break
    sleep 2
  done
  [[ "$code" == "200" ]] && ok "public URL answers 200" || warn "public URL returned $code"
  sio=$("${CURL4[@]}" -o /dev/null -m 25 -w '%{http_code}' \
    "$URL/socket.io/?EIO=4&transport=polling" || true)
  [[ "$sio" == "200" ]] && ok "socket.io handshake works through the tunnel, same origin" \
    || warn "socket.io through the tunnel returned $sio"
  # `000` IS "COULD NOT ASK", NOT "IS EXPOSED". Reporting a transport failure as
  # "/dev/sparring is PUBLIC" is a false alarm in the alarming direction, which
  # is how a check earns being ignored. Retry, then distinguish.
  dev="000"
  for _ in 1 2 3; do
    dev=$("${CURL4[@]}" -o /dev/null -m 25 -w '%{http_code}' "$URL/dev/sparring" || true)
    [[ "$dev" != "000" ]] && break
    sleep 2
  done
  if [[ "$dev" == "404" ]]; then
    ok "/dev/* refused publicly (404)"
  elif [[ "$dev" == "000" ]]; then
    warn "could not reach /dev/sparring to check it (tunnel transport) — Caddy blocks it locally"
  else
    bad "/dev/sparring is PUBLIC ($dev)"
  fi
else
  bad "the public URL never answered 200 after 60s"
fi

# =============================================================================
#  PRE-FLIGHT: walk the path a real person walks, before printing a URL.
#
#  Same standard as the containment canary (§11): a URL serving a crashing page
#  is worse than no URL, because by the time you find out you have already sent
#  it to someone. Both failures this exists to catch were invisible to every
#  check that ran before it — the site answered 200 while every JS chunk 404'd,
#  and registration returned a 500 with an empty body.
#
#  If any of this fails the URL is NOT printed.
# =============================================================================
head_ "Pre-flight against the public URL"

fetch() { "${CURL4[@]}" --max-time 25 "$@"; }
preflight_failed=0
fail_preflight() { bad "$1"; preflight_failed=1; }

if [[ "$public_ready" != "1" ]]; then
  fail_preflight "the public URL never answered, so nothing could be verified"
else
  # 1. The landing page renders. Retried: a quick tunnel caps concurrent
  #    in-flight requests and an empty body here is usually transient.
  landing=""
  for _ in $(seq 5); do
    landing=$(fetch "$URL/" || true)
    [[ -n "$landing" ]] && break
    sleep 2
  done
  [[ -n "$landing" ]] || fail_preflight "the landing page returned nothing"

  # 2. EVERY script the page references actually loads. This is the check that
  #    would have caught "Application error: a client-side exception": the
  #    document is fine and the chunks it needs are gone.
  missing=0
  checked_assets=0
  while read -r src; do
    [[ -n "$src" ]] || continue
    checked_assets=$((checked_assets + 1))
    # RETRY, AND DISTINGUISH 000 FROM 404. `000` is curl failing to complete a
    # connection, not the server saying the file is gone — and a quick tunnel
    # caps concurrent in-flight requests, so a burst of sequential asset checks
    # produces transport failures that have nothing to do with the build. The
    # first version counted those as missing assets and refused to print a URL
    # that worked, which is the cry-wolf failure that gets a check ignored.
    sc="000"
    for _ in 1 2 3; do
      sc=$(fetch -o /dev/null -w '%{http_code}' "$URL$src" || true)
      [[ "$sc" == "200" ]] && break
      sleep 1
    done
    if [[ "$sc" == "200" ]]; then
      :
    elif [[ "$sc" == "000" ]]; then
      bad "asset $src — no response after 3 tries (tunnel transport, not the build)"
      missing=$((missing + 1))
    else
      bad "asset $src -> $sc (the build is serving a page whose chunks are gone)"
      missing=$((missing + 1))
    fi
    sleep 0.2
  done < <(printf '%s' "$landing" | grep -oE '/_next/static/[^"]+\.js' | sort -u | head -12)

  # "ZERO MISSING" IS TRIVIALLY TRUE OF ZERO ASSETS. The first version of this
  # check reported "every referenced script loads" on a run where the landing
  # page had come back EMPTY — nothing to iterate, so nothing failed. That is
  # the same shape as the probes reporting "prisma noise: 0" while every probe
  # was failing to connect, and it is the exact class of bug this pre-flight
  # exists to catch. So the count is asserted, not just the failures.
  if [[ "$checked_assets" -lt 1 ]]; then
    fail_preflight "found no scripts on the landing page — it did not render"
  elif [[ "$missing" == "0" ]]; then
    ok "every referenced script loads ($checked_assets checked)"
  else
    fail_preflight "$missing of $checked_assets asset(s) missing — the page will throw a client-side exception"
  fi

  # 3. REGISTER A THROWAWAY ACCOUNT THROUGH THE REAL ROUTE, over the real
  #    hostname. This is the exact request that failed, and nothing short of
  #    making it proves it works.
  probe_handle="probe$(date +%s%N | tail -c 6)"
  reg_body=$(fetch -o - -w '\n__STATUS__=%{http_code}\n__TYPE__=%{content_type}\n' -X POST "$URL/api/auth/register" \
    -H 'Content-Type: application/json' \
    -d "{\"handle\":\"$probe_handle\",\"email\":\"$probe_handle@example.test\",\"password\":\"correct-horse-battery-staple\"}" || true)
  # PARSE THE STATUS FROM ITS OWN LINE, not by counting from the end. The
  # previous version took the last line as the content-type and the one before
  # as the status; when the content-type was EMPTY — which is exactly what a
  # crashed route returns — everything shifted by one and the failure printed
  # as "returned (500)" with an empty status. A diagnostic that garbles the one
  # number it exists to report costs a whole debugging session.
  reg_code=$(printf '%s' "$reg_body" | sed -n 's/^__STATUS__=//p' | tail -1)
  reg_type=$(printf '%s' "$reg_body" | sed -n 's/^__TYPE__=//p' | tail -1)
  if [[ "$reg_code" != "200" ]]; then
    fail_preflight "registration through the public URL returned $reg_code (${reg_type:-no content-type})"
    printf '%s\n' "$(printf '%s' "$reg_body" | head -c 400)"
  elif [[ "$reg_type" != application/json* ]]; then
    fail_preflight "registration returned $reg_code but as ${reg_type:-no content-type}, not JSON"
  else
    ok "registered a throwaway account through the real form ($probe_handle)"
  fi
fi

if [[ "$preflight_failed" != "0" ]]; then
  printf '\n'
  bad "PRE-FLIGHT FAILED — not printing a URL."
  printf '  %sThe tunnel is up but the site does not work through it. Sharing the URL\n' "$DIM"
  printf '  would send someone to a broken page. Logs: %s%s\n' "$RUN_DIR" "$RESET"
  exit 1
fi

printf '\n  %s%s%s\n\n' "$BOLD" "$URL" "$RESET"
printf '  %sShare with someone you know. A quick tunnel has no access control,\n' "$DIM"
printf '  and the judge runs untrusted code on THIS machine. Do not post it.\n\n'
printf '  The URL changes every restart, and outstanding challenge links embed it.%s\n' "$RESET"
printf '\n  Ctrl-C to stop.\n\n'

while true; do sleep 3600; done
