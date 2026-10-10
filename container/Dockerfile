FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium chromium-sandbox xvfb openbox x11vnc novnc websockify \
    socat python3 python3-venv python3-pip git curl xdotool scrot tini wmctrl x11-utils ca-certificates fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 browser \
    && mkdir /profile /workspace && chown browser:browser /profile /workspace
COPY supervisor.py windows.py computer.py /opt/igor-browser/
ARG IGOR_RUNTIME_REVISION
LABEL ai.igor.browser.runtime-revision=$IGOR_RUNTIME_REVISION
USER browser
ENV DISPLAY=:99
EXPOSE 9222 6080
ENTRYPOINT ["/usr/bin/tini", "--", "python3", "/opt/igor-browser/supervisor.py"]
