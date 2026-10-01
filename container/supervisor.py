import os
import signal
import subprocess
import time

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
    browser = start(['chromium', '--user-data-dir=/profile',
                     '--remote-debugging-port=9223', '--no-first-run',
                     '--no-default-browser-check', '--window-size=1440,1000',
                     '--disable-setuid-sandbox', 'about:blank'])
    while not stopping:
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
