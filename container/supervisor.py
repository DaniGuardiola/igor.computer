import os
import signal
import subprocess
import time
import uuid
import secrets
import json

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
    os.makedirs(os.environ['XDG_RUNTIME_DIR'], mode=0o700, exist_ok=True)
    start(['dbus-daemon', '--session', '--nofork', '--address=' + os.environ['DBUS_SESSION_BUS_ADDRESS']])
    for _ in range(100):
        if os.path.exists('/tmp/igor-session-bus'):
            break
        time.sleep(0.05)
    else:
        raise RuntimeError('Desktop session bus failed to start')
    # Activate the standard accessibility bus before Chromium starts.
    subprocess.check_call(['dbus-send', '--session', '--print-reply', '--dest=org.a11y.Bus',
                           '/org/a11y/bus', 'org.a11y.Bus.GetAddress'])
    subprocess.check_call(['gsettings', 'set', 'org.gnome.desktop.interface', 'toolkit-accessibility', 'true'])
    start(['openbox'])
    # Restore workspace count before clients place windows.
    state = '/workspace/.igor/workspaces.json'
    if os.path.exists(state):
        for _ in range(50):
            try:
                with open(state) as file:
                    count = max(json.load(file).values()) + 1
                subprocess.check_call(['wmctrl', '-n', str(count)])
                actual = subprocess.check_output(['wmctrl', '-d'], text=True).splitlines()
                if len(actual) >= count:
                    break
                time.sleep(0.1)
            except subprocess.SubprocessError:
                time.sleep(0.1)
    start(['x11vnc', '-display', ':99', '-localhost', '-nopw', '-forever',
           '-shared', '-rfbport', '5900', '-quiet'])
    # Web pages in Chromium must not be able to open an unauthenticated desktop
    # connection through guest localhost. Only the trusted host proxy knows this.
    display_credentials = 'igor-vm:' + secrets.token_urlsafe(32)
    descriptor = os.open('/tmp/igor-vm-display-auth', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, 'w') as file:
        file.write(display_credentials)
    start(['websockify', '--web=/usr/share/novnc', '--web-auth',
           '--auth-plugin=BasicHTTPAuth', '--auth-source=' + display_credentials,
           '6080', 'localhost:5900'])
    start(['socat', 'TCP-LISTEN:9222,fork,reuseaddr', 'TCP:127.0.0.1:9223'])
    # New profiles use Chromium's ordinary GTK theme setting. Existing themes
    # remain user-controlled; appearance changes use the desktop settings service.
    preferences = '/profile/Default/Preferences'
    if not os.path.exists(preferences):
        os.makedirs('/profile/Default', exist_ok=True)
        with open(preferences, 'w') as file:
            json.dump({'extensions': {'theme': {'system_theme': 1}}}, file)
    browser_args = ['chromium', '--user-data-dir=/profile',
                     '--remote-debugging-port=9223', '--no-first-run',
                     '--no-default-browser-check', '--window-size=1440,1000',
                     '--no-startup-window', '--force-renderer-accessibility']
    def launch_browser():
        process = start(browser_args)
        with open('/tmp/igor-browser-generation.tmp', 'w') as file:
            json.dump({'generation': str(uuid.uuid4())}, file)
        os.replace('/tmp/igor-browser-generation.tmp', '/tmp/igor-browser-generation.json')
        return process
    browser = launch_browser()
    restart_attempts = []
    while not stopping:
        if browser.poll() is not None:
            # Keep the computer and CDP available, without reopening user windows.
            if browser.returncode != 0:
                now = time.monotonic()
                restart_attempts = [attempt for attempt in restart_attempts if now - attempt < 30]
                if len(restart_attempts) >= 5:
                    raise RuntimeError('Chromium repeatedly failed to start')
                restart_attempts.append(now)
            else:
                restart_attempts = []
            children.remove(browser)
            time.sleep(0.5)
            browser = launch_browser()
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
