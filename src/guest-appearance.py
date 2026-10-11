"""Apply desktop appearance without restarting apps or selecting a workspace."""
import json
import os
from pathlib import Path
import signal
import struct
import subprocess
import sys
import zlib
import xml.etree.ElementTree as ET


def wallpaper(dark, width=1440, height=1000):
    # A restrained diagonal wash, shared by every workspace.
    start, end = ((24, 32, 48), (44, 58, 78)) if dark else ((231, 235, 244), (192, 212, 235))
    pixels = bytearray()
    for y in range(height):
        pixels.append(0)
        for x in range(width):
            t = (0.55 * x / (width - 1) + 0.45 * y / (height - 1))
            # Tiny deterministic grain prevents visible bands in the streamed gradient.
            noise = (((x * 374761393 + y * 668265263) ^ (x * y * 1274126177)) & 1023) / 1023 - 0.5
            pixels.extend(round(a + (b - a) * t + noise) for a, b in zip(start, end))
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b'')


def apply(dark):
    home = Path.home()
    state = home / '.config/igor-vm'
    state.mkdir(parents=True, exist_ok=True)
    theme = 'Adwaita-dark' if dark else 'Adwaita'
    for version in ('3.0', '4.0'):
        folder = home / ('.config/gtk-' + version)
        folder.mkdir(parents=True, exist_ok=True)
        (folder / 'settings.ini').write_text('[Settings]\ngtk-theme-name=' + theme + '\ngtk-application-prefer-dark-theme=' + str(int(dark)) + '\n')
    portals = home / '.config/xdg-desktop-portal'
    portals.mkdir(parents=True, exist_ok=True)
    (portals / 'portals.conf').write_text('[preferred]\ndefault=gtk\n')
    # Activate the standard settings portal used by Chromium and GTK 4.
    subprocess.run(['dbus-send', '--session', '--print-reply', '--dest=org.freedesktop.portal.Desktop',
                    '/org/freedesktop/portal/desktop', 'org.freedesktop.DBus.Peer.Ping'], check=True, stdout=subprocess.DEVNULL)
    config = home / '.xsettingsd'
    config.write_text('Net/ThemeName "' + theme + '"\nGtk/ApplicationPreferDarkTheme ' + str(int(dark)) + '\n')
    subprocess.run(['gsettings', 'set', 'org.gnome.desktop.interface', 'color-scheme', 'prefer-dark' if dark else 'prefer-light'], check=True)
    subprocess.run(['gsettings', 'set', 'org.gnome.desktop.interface', 'gtk-theme', theme], check=True)
    processes = subprocess.run(['pgrep', '-x', '-u', str(os.getuid()), 'xsettingsd'], capture_output=True, text=True)
    if processes.stdout.strip():
        for pid in processes.stdout.split():
            os.kill(int(pid), signal.SIGHUP)
    else:
        subprocess.Popen(['xsettingsd'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    rc = home / '.config/openbox/rc.xml'
    rc.parent.mkdir(parents=True, exist_ok=True)
    source = rc if rc.exists() else Path('/etc/xdg/openbox/rc.xml')
    tree = ET.parse(source)
    ET.register_namespace('', 'http://openbox.org/3.4/rc')
    node = tree.find('{http://openbox.org/3.4/rc}theme/{http://openbox.org/3.4/rc}name')
    if node is not None:
        node.text = 'Onyx' if dark else 'Clearlooks'
        tree.write(rc, encoding='utf-8', xml_declaration=True)
        subprocess.run(['openbox', '--reconfigure'], check=True)
    image = state / ('desktop-dark-v2.png' if dark else 'desktop-light-v2.png')
    if not image.exists():
        image.write_bytes(wallpaper(dark))
    subprocess.run(['feh', '--no-fehbg', '--bg-fill', str(image)], check=True)
    (state / 'appearance.json').write_text(json.dumps({'dark': dark}))


if __name__ == '__main__':
    apply(sys.argv[1] == 'dark')
    print(json.dumps({'ok': True}))
