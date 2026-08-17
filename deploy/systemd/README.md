# Stage 1 — systemd units

## Why the judge runs on the HOST, not in a container

**Mounting the Docker socket into a container is equivalent to giving that
container root on the host.** Anything holding `/var/run/docker.sock` can start
a new container with `--privileged -v /:/host` and walk out. Doing that to the
single component whose entire job is executing untrusted code inverts the
security model: §11's flag set contains the *submission*, and the containing
process would itself be trivially escapable.

Docker-in-Docker is worse again — a second daemon, its own privileged mode, and
a nested storage driver, all to avoid one systemd unit.

So the judge worker is an ordinary host process under systemd that talks to the
host's Docker daemon. `apps/judge` starts one container per submission with
§11's flags; **that** container is the security boundary, and it is the only one
that needs to be. This is what CLAUDE.md §12 Phase 2E means by "a plain VM with
a Docker socket is both simpler and safer here".

## Why the reaper is a separate unit

§11: the orphan reaper exists for the case where **the worker dies**. A reaper
that lives in the worker's process dies with it, which is decoration. It is its
own unit with its own restart policy and deliberately shares no code.

## Install

    sudo mkdir -p /etc/1v1 /var/lib/1v1/replays /var/log/caddy
    sudo cp deploy/systemd/*.service /etc/systemd/system/
    sudo cp deploy/systemd/env.example /etc/1v1/env   # then EDIT it
    sudo chmod 600 /etc/1v1/env
    sudo chown -R arena:arena /var/lib/1v1
    sudo systemctl daemon-reload
    sudo systemctl enable --now 1v1-gateway 1v1-web 1v1-judge 1v1-reaper 1v1-caddy

## Restart order does not matter, and that is on purpose

Every unit tolerates its dependencies being absent and retries. The gateway
reconciles orphaned matches, stale queue entries and stranded submissions on
every start (see `reconcileOrphanedMatches`), so an arbitrary restart order
converges rather than corrupting. On a real host restarts are frequent —
deploys, OOM, reboots — so this is the normal path, not the exceptional one.

## Two accounts, not one

`arena` runs the gateway and the web app. `arenajudge` runs the judge worker and
the reaper, and is the only account in the `docker` group.

**Being in `docker` is root-equivalent** — the group grants access to the daemon
socket, and anything with that can start a privileged container mounting `/`.
So it is a dedicated account that runs nothing else and owns no application
data: a bug in the web app cannot reach the daemon, and a bug in the judge
worker cannot read the session table.

The names deliberately do not start with a digit. `1v1` and `1v1judge` were the
obvious choice and `systemd-analyze verify` rejects them — "does not match
strict user/group name rules" — and `useradd` refuses digit-leading names
outright on some systems. Caught by running the verifier rather than by reading
the units.

    sudo useradd --system --home-dir /srv/1v1.code --shell /usr/sbin/nologin arena
    sudo useradd --system --home-dir /srv/1v1.code --shell /usr/sbin/nologin arenajudge
    sudo usermod -aG docker arenajudge
