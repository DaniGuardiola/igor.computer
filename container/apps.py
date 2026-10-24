"""Graphical applications installed in the guest, from standard .desktop entries."""
import base64
import configparser
from pathlib import Path
import subprocess
import time
from windows import windows, run

APPLICATIONS = Path('/usr/share/applications')


def catalog():
    apps = []
    for file in sorted(APPLICATIONS.glob('*.desktop')):
        if file.name == 'x11vnc.desktop': continue
        try:
            config = configparser.ConfigParser(interpolation=None, strict=False)
            config.read(file)
            item = config['Desktop Entry']
            if item.get('Type') != 'Application' or any(item.get(k, 'false').lower() == 'true' for k in ['Hidden', 'NoDisplay', 'Terminal']): continue
            if not item.get('Exec'): continue
            icon = item.get('Icon', '')
            paths = [Path(icon)] if icon.startswith('/') else [Path('/usr/share/icons/hicolor') / size / 'apps' / (icon + '.png') for size in ['64x64', '48x48', '256x256', '32x32']] + [Path('/usr/share/pixmaps') / (icon + '.png')]
            image = next((p for p in paths if p.is_file() and p.stat().st_size < 100000), None)
            apps.append({'id': file.name, 'name': 'chromium' if file.name == 'chromium.desktop' else item.get('Name', file.stem).lower(),
                         'icon': ('data:image/png;base64,' + base64.b64encode(image.read_bytes()).decode()) if image else None})
        except (KeyError, ValueError, OSError, configparser.Error): pass
    return {'apps': apps}


# gio handles Exec field codes; clients never supply commands or host paths.
def launch(app_id, desktop):
    if not any(app['id'] == app_id for app in catalog()['apps']):
        raise ValueError('Application no longer installed.')
    before = {w['id'] for w in windows()}
    subprocess.Popen(['gio', 'launch', str(APPLICATIONS / app_id)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    for _ in range(60):
        fresh = [w for w in windows() if w['id'] not in before]
        if fresh:
            for w in fresh: run('wmctrl', '-ir', w['id'], '-t', str(desktop))
            run('wmctrl', '-ia', fresh[0]['id'])
            return {'ok': True}
        time.sleep(.1)
    run('wmctrl', '-s', str(desktop))
    raise ValueError('Application did not open a window.')
