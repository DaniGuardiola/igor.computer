"""Graphical applications installed in the guest, from standard .desktop entries."""
import base64
import configparser
import os
from pathlib import Path
import shlex
import subprocess
import time
from windows import windows, run

# Flatpak installs export their entries and icons into these data folders too.
DATA = [Path(path) for path in os.environ.get('XDG_DATA_DIRS', '/usr/local/share:/usr/share').split(':') if path]
NAMES = {'chromium.desktop': 'chromium', 'xfce4-terminal.desktop': 'terminal', 'org.gnome.Software.desktop': 'app store'}
# Terminal preferences open from the terminal's own menu.
HIDDEN = {'x11vnc.desktop', 'xfce4-terminal-settings.desktop'}
ICONS = {'.png': ('image/png', 100000), '.svg': ('image/svg+xml', 48000)}


def entries():
    # Earlier data folders win, as in XDG_DATA_DIRS.
    found = {}
    for data in DATA:
        for file in sorted((data / 'applications').glob('*.desktop')):
            found.setdefault(file.name, file)
    return found


def icon(name):
    if name.startswith('/'): paths = [Path(name)]
    else:
        paths = [data / 'icons/hicolor' / size / 'apps' / (name + '.png') for data in DATA for size in ['64x64', '48x48', '128x128', '256x256', '32x32']]
        paths += [data / 'icons/hicolor/scalable/apps' / (name + '.svg') for data in DATA] + [Path('/usr/share/pixmaps') / (name + '.png')]
    for path in paths:
        kind, limit = ICONS.get(path.suffix, (None, 0))
        if kind and path.is_file() and path.stat().st_size < limit:
            return 'data:' + kind + ';base64,' + base64.b64encode(path.read_bytes()).decode()
    return None


def window_class(item):
    # Viewers find an app's windows by WM_CLASS, usually its command's name.
    if item.get('StartupWMClass'): return item['StartupWMClass'].lower()
    words = shlex.split(item['Exec'])
    if Path(words[0]).name == 'flatpak':
        words = [word.split('=', 1)[1] for word in words if word.startswith('--command=')] or words
    return Path(words[0]).name.lower()


def catalog():
    apps = []
    for name, file in sorted(entries().items()):
        if name in HIDDEN: continue
        try:
            config = configparser.ConfigParser(interpolation=None, strict=False)
            config.read(file)
            item = config['Desktop Entry']
            if item.get('Type') != 'Application' or any(item.get(k, 'false').lower() == 'true' for k in ['Hidden', 'NoDisplay', 'Terminal']): continue
            # Openbox isn't a desktop environment, so entries limited to one never apply.
            if not item.get('Exec') or item.get('OnlyShowIn'): continue
            apps.append({'id': name, 'name': NAMES.get(name, item.get('Name', file.stem).lower()), 'icon': icon(item.get('Icon', '')), 'window': window_class(item)})
        except (KeyError, ValueError, OSError, configparser.Error): pass
    return {'apps': apps}


# gio handles Exec field codes; clients never supply commands or host paths.
def launch(app_id, desktop):
    if not any(app['id'] == app_id for app in catalog()['apps']):
        raise ValueError('Application no longer installed.')
    before = {w['id'] for w in windows()}
    # Apps start in /workspace, where agents' shell commands run too.
    subprocess.Popen(['gio', 'launch', str(entries()[app_id])], cwd='/workspace', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    # Flatpak apps start their sandbox first, so allow them longer.
    for _ in range(150):
        fresh = [w for w in windows() if w['id'] not in before]
        if fresh:
            for w in fresh: run('wmctrl', '-ir', w['id'], '-t', str(desktop))
            run('wmctrl', '-ia', fresh[0]['id'])
            return {'ok': True}
        time.sleep(.1)
    run('wmctrl', '-s', str(desktop))
    raise ValueError('Application did not open a window.')
