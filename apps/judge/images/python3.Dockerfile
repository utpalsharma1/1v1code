# 1v1-judge-python3

FROM python:3.12-slim-bookworm

RUN useradd --uid 1000 --create-home --shell /usr/sbin/nologin runner

COPY runner.py /opt/runner.py
RUN chmod 0555 /opt/runner.py

USER runner
WORKDIR /tmp
ENTRYPOINT ["python3", "/opt/runner.py"]
