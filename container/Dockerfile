FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium chromium-sandbox xvfb openbox x11vnc novnc websockify \
    socat python3 tini ca-certificates fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 browser \
    && mkdir /profile && chown browser:browser /profile
COPY supervisor.py /opt/igor-browser/supervisor.py
USER browser
ENV DISPLAY=:99
EXPOSE 9222 6080
ENTRYPOINT ["/usr/bin/tini", "--", "python3", "/opt/igor-browser/supervisor.py"]
