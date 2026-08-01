# =============================================================================
#  Shared checking primitives.
#
#  SIXTEEN INSTANCES OF ONE BUG. Every one of these was a check that reported
#  success, or reported the wrong failure, while the thing it watched was
#  broken or fine:
#
#    - "0 assets missing" on a page that came back EMPTY (nothing iterated)
#    - "prisma noise: 0" on five probes that never connected
#    - a containment suite green because the canary never executed
#    - "/dev/sparring is PUBLIC (000)" — a TRANSPORT FAILURE announced as a
#      security exposure, on the run where it was correctly blocked
#    - a readiness check satisfied by a STALE server from a previous run
#    - a security test whose verdict flipped with an ambient env var
#
#  A rule someone has to remember is not the fix — sixteen says so, and two of
#  the sixteen are in the pre-flight written to catch the other fourteen. So the
#  shapes that keep recurring get functions, and the functions refuse to be
#  wrong in the ways the humans were.
#
#  Three primitives, one per failure shape:
#
#    require_env      an entry point states what it needs and refuses without it
#    http_probe       "could not ask" is never confused with "asked and got X"
#    require_checked  zero iterations is a FAILURE, never a vacuous pass
#
#  Source it, do not execute it:  . "$(dirname "$0")/lib/check.sh"
# =============================================================================

# Colours are defined by the caller; fall back so this file is usable alone.
: "${RESET:=$'\e[0m'}" "${GREEN:=$'\e[32m'}" "${RED:=$'\e[31m'}" "${YELLOW:=$'\e[33m'}"
_ok()   { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
_bad()  { printf '  %s✗%s %s\n' "$RED" "$RESET" "$1"; }
_warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$1"; }

# -----------------------------------------------------------------------------
#  require_env NAME...
#
#  Refuse to start without the variables this entry point needs, and NAME THEM
#  ALL AT ONCE rather than failing on whichever is missing first.
#
#  The bug: `pnpm tunnel` started a production web server with no DATABASE_URL
#  because it never sourced .env. Every GET worked — the landing page, the
#  assets, the socket handshake — and the first route that touched Postgres
#  returned a 500 with an empty body. The failure surfaced to a player rather
#  than to the operator, three hops and one session away from its cause.
#
#  Failing here costs a line of output. Failing at the first query costs a
#  stranger's signup.
# -----------------------------------------------------------------------------
require_env() {
  local missing=() name
  for name in "$@"; do
    [[ -n "${!name:-}" ]] || missing+=("$name")
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    _bad "missing required environment: ${missing[*]}"
    _bad "expected in .env at the repo root — this process would start and then fail on first use"
    return 1
  fi
  _ok "environment complete (${*})"
  return 0
}

# -----------------------------------------------------------------------------
#  http_probe URL [expected] [attempts]
#
#  Echoes the HTTP status, or the literal `unreachable` when the request never
#  completed. Retries, because a quick tunnel caps concurrent in-flight requests
#  and a burst of checks produces transport failures that mean nothing about the
#  server.
#
#  THE DISTINCTION IS THE POINT. curl writes `000` for "I could not complete a
#  connection", and it looks exactly like a status code. Treating it as one
#  produced BOTH directions of false alarm from the same conflation:
#
#    - `000` counted as a missing asset  → refused to print a URL that worked
#    - `000` counted as "not 404"        → announced /dev/sparring as PUBLIC,
#                                          i.e. reported a security exposure on
#                                          the run where it was correctly blocked
#
#  A caller that wants "reachable and 404" must ask for exactly that, and gets
#  `unreachable` when it cannot be established either way.
# -----------------------------------------------------------------------------
http_probe() {
  local url="$1" attempts="${3:-3}" code="" i
  for ((i = 0; i < attempts; i++)); do
    code=$(curl -4 -s -o /dev/null --max-time 20 \
      --doh-url https://cloudflare-dns.com/dns-query \
      -w '%{http_code}' "$url" 2>/dev/null || true)
    [[ -n "$code" && "$code" != "000" ]] && { printf '%s' "$code"; return 0; }
    sleep 2
  done
  printf 'unreachable'
  return 0
}

# -----------------------------------------------------------------------------
#  expect_status LABEL URL EXPECTED
#
#  Three outcomes, never two. `unreachable` is reported as such and returns a
#  DISTINCT exit code, so a caller can decide whether not knowing is fatal —
#  rather than having that decision made for it by a coincidence of string
#  comparison.
#
#    0  matched          2  wrong status          3  could not reach
# -----------------------------------------------------------------------------
expect_status() {
  local label="$1" url="$2" want="$3" got
  got=$(http_probe "$url")
  if [[ "$got" == "$want" ]]; then
    _ok "$label ($got)"
    return 0
  fi
  if [[ "$got" == "unreachable" ]]; then
    _warn "$label — no response after retries; could not verify (transport, not the server)"
    return 3
  fi
  _bad "$label — expected $want, got $got"
  return 2
}

# -----------------------------------------------------------------------------
#  require_checked COUNT LABEL
#
#  ZERO ITERATIONS IS A FAILURE. "No failures" over an empty collection is
#  vacuously true and is the single most common shape in the sixteen: the asset
#  loop over a page that returned nothing, the probes that never connected, the
#  containment suite whose canary never ran.
#
#  Any loop that reports "all N passed" must call this with N first, so the
#  count is asserted rather than assumed.
# -----------------------------------------------------------------------------
require_checked() {
  local count="${1:-0}" label="${2:-items}"
  if [[ "$count" -lt 1 ]]; then
    _bad "checked 0 $label — nothing was verified, so 'no failures' means nothing"
    return 1
  fi
  return 0
}
