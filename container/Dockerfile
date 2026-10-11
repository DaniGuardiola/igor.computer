FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium chromium-sandbox xvfb openbox x11vnc novnc websockify \
    dbus dbus-x11 at-spi2-core libglib2.0-bin gsettings-desktop-schemas libxkbcommon0 socat python3 python3-venv python3-pip git curl xdotool scrot tini wmctrl x11-utils ca-certificates fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 browser \
    && mkdir /profile /workspace && chown browser:browser /profile /workspace
# Pinned upstream release; verify each supported architecture against its hash.
RUN set -eu; case "$(dpkg --print-architecture)" in \
      arm64) target=aarch64; checksum=fe3e87e58caa329e1137956cff6da77055d9753cbfd43776d478dc470d40811a ;; \
      amd64) target=x86_64; checksum=ecd05cc31027a12de1e6b4cb23ad5760420ef28f9ca3b7b0394fa4b26ed9a9d9 ;; \
      *) exit 1 ;; esac; \
    curl -fL --retry 3 "https://github.com/agent-sh/computer-use-linux/releases/download/v0.7.15/computer-use-linux-$target-unknown-linux-gnu" -o /usr/local/bin/computer-use-linux; \
    echo "$checksum  /usr/local/bin/computer-use-linux" | sha256sum -c -; \
    chmod 755 /usr/local/bin/computer-use-linux
COPY supervisor.py windows.py computer.py /opt/igor-browser/
ARG IGOR_RUNTIME_REVISION
LABEL ai.igor.browser.runtime-revision=$IGOR_RUNTIME_REVISION
USER browser
ENV DISPLAY=:99 DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/igor-session-bus XDG_RUNTIME_DIR=/tmp/igor-runtime XDG_SESSION_TYPE=x11 COMPUTER_USE_LINUX_INDICATOR=0
EXPOSE 9222 6080
ENTRYPOINT ["/usr/bin/tini", "--", "python3", "/opt/igor-browser/supervisor.py"]
