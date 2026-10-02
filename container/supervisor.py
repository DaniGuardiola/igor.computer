import os
import signal
import subprocess
import time
import uuid
import json
import urllib.request
import urllib.error

children = []
stopping = False

def stop(*_):
    global stopping
    stopping = True

signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)

def start(args):
    process = subprocess.Popen(args)
    children.append(process)
    return process

try:
    # This named container exclusively owns its profile volume. Remove stale
    # singleton symlinks left by a previous container hostname after a crash.
    for name in ('SingletonLock', 'SingletonSocket', 'SingletonCookie'):
        path = '/profile/' + name
        if os.path.islink(path):
            os.unlink(path)
    start(['Xvfb', ':99', '-screen', '0', '1440x1000x24', '-nolisten', 'tcp'])
    for _ in range(100):
        if os.path.exists('/tmp/.X11-unix/X99'):
            break
        time.sleep(0.05)
    else:
        raise RuntimeError('Virtual display failed to start')
    start(['openbox'])
    start(['x11vnc', '-display', ':99', '-localhost', '-nopw', '-forever',
           '-shared', '-rfbport', '5900', '-quiet'])
    start(['websockify', '--web=/usr/share/novnc', '6080', 'localhost:5900'])
    start(['socat', 'TCP-LISTEN:9222,fork,reuseaddr', 'TCP:127.0.0.1:9223'])
    browser_args = ['chromium', '--user-data-dir=/profile',
                     '--remote-debugging-port=9223', '--no-first-run',
                     '--no-default-browser-check', '--window-size=1440,1000',
                     '--disable-setuid-sandbox', 'about:blank']
    def launch_browser(restore=False):
        process = start(browser_args[:-1] + (["--restore-last-session"] if restore else ["about:blank"]))
        with open('/tmp/igor-browser-generation.tmp', 'w') as file:
            json.dump({'generation': str(uuid.uuid4())}, file)
        os.replace('/tmp/igor-browser-generation.tmp', '/tmp/igor-browser-generation.json')
        return process
    browser = launch_browser(restore=True)
    restart_attempts = []
    next_window_check = time.monotonic() + 5
    while not stopping:
        if browser.poll() is not None:
            # Keep X11, the window manager and VNC alive when the last window closes.
            if browser.returncode != 0:
                now = time.monotonic()
                restart_attempts = [attempt for attempt in restart_attempts if now - attempt < 30]
                if len(restart_attempts) >= 5:
                    raise RuntimeError('Chromium repeatedly failed to start')
                restart_attempts.append(now)
            else:
                # Deliberately closing windows is not a crash or failed launch.
                restart_attempts = []
            children.remove(browser)
            time.sleep(0.5)
            browser = launch_browser()
            next_window_check = time.monotonic() + 5
        elif time.monotonic() >= next_window_check:
            next_window_check = time.monotonic() + 2
            # Extensions can keep Chromium alive after its last window closes.
            try:
                with urllib.request.urlopen('http://127.0.0.1:9223/json/list', timeout=1) as response:
                    pages = json.load(response)
                if not any(page.get('type') == 'page' for page in pages):
                    request = urllib.request.Request('http://127.0.0.1:9223/json/new?about:blank', method='PUT')
                    with urllib.request.urlopen(request, timeout=1) as response:
                        response.read()
            except (OSError, ValueError, urllib.error.URLError):
                pass  # Startup/restart health checks already surface unavailable CDP.
        for child in children:
            if child.poll() is not None:
                raise RuntimeError('Browser component exited: ' + str(child.args[0]))
        time.sleep(0.5)
finally:
    # Give Chromium first chance to flush its profile while the display still exists.
    if 'browser' in globals() and browser.poll() is None:
        browser.terminate()
        try:
            browser.wait(timeout=15)
        except subprocess.TimeoutExpired:
            browser.kill()
    for child in reversed(children):
        if child.poll() is None:
            child.terminate()
    for child in children:
        try:
            child.wait(timeout=3)
        except subprocess.TimeoutExpired:
            child.kill()
