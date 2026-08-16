#!/usr/bin/env bash
# =============================================================================
# Bring the whole stack up, detached, idempotently.
#
#   pnpm stack          start everything that is not already running
#   pnpm stack:fresh    also re-push the schema and re-seed
#   pnpm stack:down     stop the three node services (leaves Postgres/Redis up)
#   pnpm stack:status   what is running, and whether the routes answer
#
# NOT `pnpm up`: that is a built-in alias for `pnpm update`, so it silently ran
# a dependency install instead of this script. Namespaced to stay clear of every
# reserved pnpm verb.
#
# WHY THIS EXISTS: the runbook was seven commands that had to be pasted in the
# right order, and getting it wrong produced symptoms that looked like product
# bugs — a dead judge worker makes every submission resolve INTERNAL_ERROR and
# void the match, which is indistinguishable from a relay fault from the UI.
#
# SELF-SAFE PROCESS HANDLING. `pkill -f` has matched its own shell repeatedly in
# this project, because the pattern appears in the killing command's own argv.
# Everything here works from PID FILES written at start, and every kill checks
# that the PID is still the process we started before signalling it.
#
# DETACHED ON PURPOSE. `setsid … < /dev/null &` puts each service in its own
# session, so closing the terminal does not take them with it, and a later kill
# cannot walk back up the process group into this script.
# =============================================================================
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
ROOT="$PWD"
RUN="$ROOT/var/run"
LOG="$ROOT/var/log"
mkdir -p "$RUN" "$LOG"

# shellcheck disable=SC1091
set -a; [ -f "$ROOT/.env" ] && . "$ROOT/.env"; set +a

# The stack starts Postgres, Redis, the judge, the gateway and the web app.
# Every one of them fails on first use without these, and "fails on first use"
# means the failure lands on a player rather than here. See scripts/lib/check.sh.
. "$ROOT/scripts/lib/check.sh"
require_env DATABASE_URL REDIS_URL SESSION_SECRET || exit 1

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; }
warn() { printf "  %s!%s %s\n" "${YELLOW:-}" "${RESET:-}" "$1"; }
info() { printf '  · %s\n' "$1"; }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# --- pid files -----------------------------------------------------------------
# A pid file alone is not proof: pids are reused. Each check also confirms the
# process's command line still looks like the service we started.
running() {           # running <name> <argv-fragment>
  local pidfile="$RUN/$1.pid" pid
  [ -f "$pidfile" ] || return 1
  pid="$(cat "$pidfile" 2>/dev/null)"
  [ -n "${pid:-}" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q -- "$2" || return 1
  printf '%s' "$pid"
}

# The environment each service's behaviour depends on. A change to any of these
# means a running instance is stale, and "stale but running" is the pidfile bug
# wearing different clothes: something IS running, but not the thing you just
# configured.
#
# This was found the expensive way. The gateway's WEB_ORIGIN gained the
# production-e2e proxy origin, `pnpm stack` reported "gateway already running",
# and six specs failed against a gateway still enforcing the old allowlist. The
# config on disk and the config in memory disagreed and nothing said so.
# Which source trees a service actually runs. Used to answer "is the code that
# is running the code I just wrote", which is a different question from "is the
# config that is running the config I just wrote" and bit twice in one session:
# the gateway kept serving the old match.created shape after it was edited,
# because nothing about the ENVIRONMENT had changed.
#
# Same rule as the pidfile check and the BUILD_ID comparison in tunnel.sh:
# "something is running" is not "what I just wrote is running".
config_src() {
  case "$1" in
    gateway) printf '%s' "apps/gateway/src packages/core/src packages/proto/src packages/db/src" ;;
    judge)   printf '%s' "apps/judge/src packages/proto/src packages/core/src" ;;
    web)     printf '%s' "" ;;   # next dev reloads itself
    *)       printf '' ;;
  esac
}

# Newest modification time across a service's sources, in epoch seconds.
newest_src() {
  local dirs; dirs="$(config_src "$1")"
  [ -n "$dirs" ] || { printf '0'; return 0; }
  # shellcheck disable=SC2086
  find $dirs -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.prisma' \) \
    -printf '%T@\n' 2>/dev/null | sort -rn | head -1 | cut -d. -f1
}

config_env() {
  case "$1" in
    gateway) printf '%s|%s|%s' "${WEB_ORIGIN:-}" "${REDIS_URL:-}" "${GATEWAY_PORT:-}" ;;
    judge)   printf '%s|%s|%s' "${REDIS_URL:-}" "${JUDGE_CONCURRENCY:-}" "${JUDGE_STRICT:-}" ;;
    web)     printf '%s|%s' "${NEXT_PUBLIC_GATEWAY_URL:-}" "${TRUSTED_PROXY:-}" ;;
    *)       printf '' ;;
  esac
}

start() {             # start <name> <argv-fragment> <command...>
  local name="$1" frag="$2"; shift 2
  local pid want have
  want="$(config_env "$name" | cksum | cut -d' ' -f1)"
  if pid="$(running "$name" "$frag")"; then
    have="$(cat "$RUN/$name.env" 2>/dev/null || echo "")"
    local started newest
    started="$(stat -c %Y "$RUN/$name.pid" 2>/dev/null || echo 0)"
    newest="$(newest_src "$name")"
    if [ -n "$(config_env "$name")" ] && [ "$want" != "$have" ]; then
      warn "$name is running with STALE CONFIG — restarting it"
      warn "  (its environment changed since it started; a running process is not"
      warn "   evidence that the config you just edited is in effect)"
      stop "$name" "$frag"
    elif [ "${newest:-0}" -gt "${started:-0}" ] 2>/dev/null; then
      warn "$name is running STALE CODE — restarting it"
      warn "  (source under $(config_src "$name") changed after it started)"
      stop "$name" "$frag"
    else
      ok "$name already running (pid $pid)"
      return 0
    fi
  fi
  setsid nohup "$@" > "$LOG/$name.log" 2>&1 < /dev/null &
  echo $! > "$RUN/$name.pid"
  printf '%s' "$want" > "$RUN/$name.env"
  ok "$name started (pid $(cat "$RUN/$name.pid")) → var/log/$name.log"
}

stop() {              # stop <name> <argv-fragment>
  local name="$1" frag="$2" pid
  if pid="$(running "$name" "$frag")"; then
    # Kill the whole PROCESS GROUP, not just the pid. `pnpm --filter … dev` is a
    # wrapper: it spawns `next dev`, which spawns `next-server`, and signalling
    # only the wrapper orphans a live server still holding port 3000. Because
    # every service was started with `setsid`, it is its own group leader, so
    # `kill -- -$pid` reaches exactly its own descendants and nothing else —
    # this shell is in a different session and cannot be caught by it.
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null
    ok "$name stopped (pid $pid)"
  else
    info "$name not running"
  fi
  rm -f "$RUN/$name.pid"
}

# --- waiting -------------------------------------------------------------------
wait_http() {         # wait_http <url> <label> <seconds>
  local url="$1" label="$2" limit="${3:-90}" i=0
  while [ "$i" -lt "$limit" ]; do
    if curl -fsS -o /dev/null -m 5 "$url" 2>/dev/null; then ok "$label"; return 0; fi
    sleep 1; i=$((i + 1))
  done
  bad "$label did not answer within ${limit}s"
  return 1
}

wait_log() {          # wait_log <name> <pattern> <seconds>
  local name="$1" pattern="$2" limit="${3:-60}" i=0
  while [ "$i" -lt "$limit" ]; do
    grep -q -- "$pattern" "$LOG/$name.log" 2>/dev/null && { ok "$name ready"; return 0; }
    sleep 1; i=$((i + 1))
  done
  bad "$name did not report ready within ${limit}s — see var/log/$name.log"
  return 1
}

# --- commands ------------------------------------------------------------------
NODE=(node --experimental-strip-types)

cmd_up() {
  local fresh="${1:-}"

  head_ "Postgres + Redis"
  docker compose up -d >/dev/null 2>&1
  local i=0
  while [ "$i" -lt 60 ]; do
    if [ "$(docker compose ps --format '{{.Health}}' 2>/dev/null | grep -c healthy)" -ge 2 ]; then break; fi
    sleep 1; i=$((i + 1))
  done
  if [ "$(docker compose ps --format '{{.Health}}' 2>/dev/null | grep -c healthy)" -ge 2 ]; then
    ok "postgres healthy"; ok "redis healthy"
  else
    bad "containers not healthy — docker compose ps"; return 1
  fi

  if [ "$fresh" = "--fresh" ]; then
    head_ "Schema + seed"
    pnpm db:push  >/dev/null 2>&1 && ok "schema pushed"  || bad "db:push failed"
    # db:seed runs the full bank gate first and refuses if it fails. There is no
    # override — see packages/db/prisma/seed.ts.
    pnpm db:seed >/dev/null 2>&1 && ok "problems seeded (bank gate green)" || bad "db:seed failed — run pnpm db:verify"
  fi

  head_ "Services"
  start judge   "judge/src/index.ts"   "${NODE[@]}" apps/judge/src/index.ts
  start gateway "gateway/src/index.ts" "${NODE[@]}" apps/gateway/src/index.ts
  start web     "@1v1/web"             pnpm --filter @1v1/web dev

  head_ "Readiness"
  wait_log  judge   "Judge worker up" 60
  wait_log  gateway "listening on"    60
  wait_http "http://localhost:3000/"  "web responding" 120

  cmd_status
}

cmd_down() {
  head_ "Stopping services"
  stop web     "@1v1/web"
  stop gateway "gateway/src/index.ts"
  stop judge   "judge/src/index.ts"
  info "Postgres and Redis left running — 'docker compose down' stops those"
}

cmd_status() {
  local failed=0
  head_ "Status"
  docker compose ps --format '  {{.Service}}: {{.Status}}' 2>/dev/null || bad "docker unavailable"
    # A PID FILE IS NOT EVIDENCE. This reported healthy while an orphaned
  # gateway held :4000 and the pidfile pointed at a newer process that had
  # failed to bind — so a security probe ran against a build nobody thought
  # was live, and its result looked real. Check the port, and check who owns
  # it.
  for triple in "judge:judge/src/index.ts:" "gateway:gateway/src/index.ts:4000" "web:@1v1/web:3000"; do
    local name port pid owner
    name="${triple%%:*}"; port="${triple##*:}"
    local frag="${triple#*:}"; frag="${frag%:*}"

    if pid="$(running "$name" "$frag")"; then ok "$name (pid $pid)"; else bad "$name not running"; failed=1; fi

    [ -n "$port" ] || continue
    owner="$(ss -ltnp 2>/dev/null | grep ":$port " | grep -oP 'pid=\K[0-9]+' | head -1)"
    if [ -z "$owner" ]; then
      bad "  nothing is listening on :$port"
      failed=1
    elif [ -n "${pid:-}" ] && [ "$owner" != "$pid" ] && ! pstree -p "$pid" 2>/dev/null | grep -q "($owner)"; then
      bad "  :$port is held by pid $owner, NOT by $name (pid $pid) — stale process"
      failed=1
    fi

      # A flag that disables security enforcement must be loud whenever it is
  # on. probe:visibility uses it for its positive control and it must never
  # be left set by accident.
    if [ "$name" = "gateway" ] && [ -n "$owner" ]; then
      if tr "\0" "\n" < "/proc/$owner/environ" 2>/dev/null | grep -q "^BREAK_VISIBILITY=1$"; then
        printf "  \033[31m!! BREAK_VISIBILITY=1 IS SET — the visibility rule is DISABLED\033[0m\n"
        printf "     Every probe result is meaningless until this gateway is restarted.\n"
        failed=1
      fi
    fi
  done

  head_ "Routes"
  for route in / /play /dev/sparring /dev/spectate /dev/hud /dev/judge /dev/kitchen-sink /login /register; do
    local code
    code="$(curl -s -o /dev/null -m 30 -w '%{http_code}' "http://localhost:3000$route" 2>/dev/null)"
    if [ "$code" = "200" ]; then ok "$(printf '%-20s %s' "$route" "$code")"
    else bad "$(printf '%-20s %s' "$route" "${code:-no response}")"; failed=1; fi
  done
  local sio
  sio="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "http://localhost:4000/socket.io/?EIO=4&transport=polling" 2>/dev/null)"
  if [ "$sio" = "200" ]; then ok "$(printf '%-20s %s' "gateway :4000" "$sio")"
  else bad "$(printf '%-20s %s' "gateway :4000" "${sio:-no response}")"; failed=1; fi

  printf '\n'
  if [ "$failed" -eq 0 ]; then
    printf '  \033[32mStack is up.\033[0m Two windows: /play and /dev/sparring. Watch at /dev/spectate.\n\n'
  else
    printf '  \033[31mSomething is not answering.\033[0m Logs are in var/log/.\n\n'
  fi
  return "$failed"
}

case "${1:-up}" in
  up)     cmd_up "${2:-}" ;;
  down)   cmd_down ;;
  status) cmd_status ;;
  *)      echo "usage: $0 [up [--fresh] | down | status]" >&2; exit 2 ;;
esac
