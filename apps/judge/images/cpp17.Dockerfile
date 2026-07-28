# 1v1-judge-cpp17
#
# Built once, reused for every submission. The container is started with
# --read-only, so nothing here may assume a writable rootfs; the runner works
# entirely inside a tmpfs at /tmp.

FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends g++ python3-minimal \
  && rm -rf /var/lib/apt/lists/*

# Non-root, no shell, no home. uid 1000 matches the tmpfs mode used by the
# worker so /tmp is writable without making the rootfs writable.
RUN useradd --uid 1000 --create-home --shell /usr/sbin/nologin runner

COPY runner.py /opt/runner.py
RUN chmod 0555 /opt/runner.py

USER runner
WORKDIR /tmp
ENTRYPOINT ["python3", "/opt/runner.py"]
