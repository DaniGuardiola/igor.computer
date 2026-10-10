"""Small X11 window-manager bridge. Called through authenticated host service."""
import json
import re
import subprocess
import sys


def run(*args):
    return subprocess.check_output(args, text=True, timeout=3).strip()


def generation():
    with open('/tmp/igor-browser-generation.json') as file:
        return json.load(file)['generation']


def windows():
    active_match = re.search(r'0x[0-9a-fA-F]+', run('xprop', '-root', '_NET_ACTIVE_WINDOW'))
    active = int(active_match.group(0), 16) if active_match else 0
    result = []
    for line in run('wmctrl', '-lpG').splitlines():
        parts = line.split(None, 8)
        if len(parts) < 9:
            continue
        identifier, desktop, _, x, y, width, height, _ = parts[:8]
        title = parts[8]
        kind = run('xprop', '-id', identifier, 'WM_CLASS')
        # Only managed Chromium windows, including its dialogs and popups.
        if 'chromium' not in kind.lower():
            continue
        result.append({'id': identifier, 'title': title or 'browser',
                       'active': int(identifier, 16) == active, 'desktop': int(desktop),
                       'x': int(x), 'y': int(y), 'width': int(width), 'height': int(height)})
    return result


def execute(action, identifier=None, expected=None):
    current = generation()
    entries = windows()
    if action != 'list' and current != expected:
        raise ValueError('Browser restarted. Refresh the window list and retry.')
    if action == 'restore':
        # Keep workspace assignments while restoring sizes and minimized windows.
        # Fixed-size dialogs cannot maximize; raise them without resizing.
        for entry in entries:
            run('wmctrl', '-ia', entry['id'])
            allowed = run('xprop', '-id', entry['id'], '_NET_WM_ALLOWED_ACTIONS')
            if '_NET_WM_ACTION_MAXIMIZE_HORZ' in allowed and '_NET_WM_ACTION_MAXIMIZE_VERT' in allowed:
                run('wmctrl', '-ir', entry['id'], '-b', 'remove,fullscreen')
                run('wmctrl', '-ir', entry['id'], '-b', 'add,maximized_vert,maximized_horz')
        # Preserve the previously focused window, including an active modal dialog.
        active = next((entry for entry in entries if entry['active']), None)
        if active:
            run('wmctrl', '-ia', active['id'])
    elif action in ('focus', 'close'):
        if not identifier or not re.fullmatch(r'0x[0-9a-fA-F]+', identifier) or not any(entry['id'] == identifier for entry in entries):
            raise ValueError('Window is no longer available.')
        run('wmctrl', '-ia' if action == 'focus' else '-ic', identifier)
    elif action != 'list':
        raise ValueError('Unknown window action.')
    return {'generation': current, 'windows': windows()}


if __name__ == '__main__':
    try:
        print(json.dumps(execute(*sys.argv[1:]), ensure_ascii=False))
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(json.dumps({'error': str(error)}))
        sys.exit(1)
