"""Computer operations inside the guest, never on the user's host."""
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from windows import windows, generation, run

ROOT = Path('/workspace')
STATE = ROOT / '.igor'


def workspace_path(value, allow_root=False):
    if not isinstance(value, str) or '\x00' in value:
        raise ValueError('Provide a workspace-relative path.')
    path = (ROOT / value).resolve()
    if not path.is_relative_to(ROOT) or (path == ROOT and not allow_root):
        raise ValueError('Path must be inside /workspace.')
    return path


def workspace(action, args):
    STATE.mkdir(exist_ok=True)
    file = STATE / 'workspaces.json'
    data = json.loads(file.read_text()) if file.exists() else {'shared': 0}
    name = args.get('name', 'shared')
    # The original shared desktop is the user's default; preserve existing windows.
    if name == 'user': name = 'shared'
    labels_file = STATE / 'workspace-labels.json'
    labels = json.loads(labels_file.read_text()) if labels_file.exists() else {}
    if not isinstance(name, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,60}', name):
        raise ValueError('Invalid workspace name.')
    if action == 'workspace_create' and name not in data:
        if len(data) >= 32:
            raise ValueError('Maximum 32 workspaces.')
        data[name] = max(data.values()) + 1
        run('wmctrl', '-n', str(max(data.values()) + 1))
        temporary = file.with_suffix('.tmp')
        temporary.write_text(json.dumps(data))
        temporary.replace(file)
    if action == 'workspace_create' and isinstance(args.get('label'), str):
        label = args['label'].strip()
        if not label or len(label) > 80: raise ValueError('Invalid workspace label.')
        labels[name] = label
        temporary = labels_file.with_suffix('.tmp')
        temporary.write_text(json.dumps(labels))
        temporary.replace(labels_file)
    if action != 'workspace_list' and name not in data:
        raise ValueError('Create the workspace first.')
    if action == 'workspace_select':
        run('wmctrl', '-s', str(data[name]))
    if action == 'workspace_move':
        identifier = args.get('id')
        if args.get('generation') != generation():
            raise ValueError('Refresh the window list after browser restart.')
        if not any(window['id'] == identifier for window in windows()):
            raise ValueError('Window no longer available.')
        run('wmctrl', '-ir', identifier, '-t', str(data[name]))
    if action == 'workspace_open_browser':
        url = args.get('url', 'about:blank')
        if not isinstance(url, str) or not re.match(r'^(https?://|about:blank$)', url):
            raise ValueError('Provide an HTTP(S) URL or about:blank.')
        before = {window['id'] for window in windows()}
        # Chromium's singleton hands this to the existing process/profile.
        run('chromium', '--user-data-dir=/profile', '--new-window', url)
        for _ in range(50):
            fresh = [window for window in windows() if window['id'] not in before]
            if fresh:
                for window in fresh:
                    run('wmctrl', '-ir', window['id'], '-t', str(data[name]))
                break
            time.sleep(0.1)
        else:
            raise ValueError('Browser window did not appear.')
    active = next(int(line.split()[0]) for line in run('wmctrl', '-d').splitlines() if line.split()[1] == '*')
    return {'workspaces': [{'name': key, 'label': 'user' if key == 'shared' else labels.get(key, key), 'desktop': value, 'active': value == active} for key, value in data.items()],
            'generation': generation(), 'windows': windows()}


def execute(action, args):
    if action == 'status':
        busy = False
        for file in Path('/proc').glob('[0-9]*/cmdline'):
            try:
                parts = file.read_bytes().split(b'\0')
                if b'/opt/igor-browser/computer.py' in parts:
                    index = parts.index(b'/opt/igor-browser/computer.py')
                    if len(parts) > index + 1 and parts[index + 1] != b'status': busy = True
            except OSError: pass
        return {'busy': busy}
    if action in ('workspace_list', 'workspace_create', 'workspace_select', 'workspace_move', 'workspace_open_browser'):
        return workspace(action, args)
    if action == 'exec':
        command = args.get('command')
        if not isinstance(command, str) or not command.strip() or len(command) > 32000:
            raise ValueError('Provide a shell command, maximum 32000 characters.')
        timeout = args.get('timeoutSeconds', 30)
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not 1 <= timeout <= 120:
            raise ValueError('Timeout must be 1-120 seconds.')
        cwd = ROOT if not args.get('cwd') else workspace_path(args['cwd'], allow_root=True)
        # Output redirected to files to cap memory even for a noisy command.
        with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
            process = subprocess.Popen(['/bin/bash', '-lc', command], cwd=cwd, stdout=out, stderr=err, start_new_session=True)
            timed_out = False
            try:
                process.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                import signal
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
                timed_out = True
            out.seek(0); err.seek(0)
            stdout, stderr = out.read(256 * 1024 + 1), err.read(256 * 1024 + 1)
            return {'exitCode': process.returncode, 'timedOut': timed_out, 'stdout': stdout[:256 * 1024].decode(errors='replace'),
                    'stderr': stderr[:256 * 1024].decode(errors='replace'), 'truncated': len(stdout) > 256 * 1024 or len(stderr) > 256 * 1024}
    if action == 'file':
        operation = args.get('operation', 'read')
        path = workspace_path(args.get('path'), allow_root=operation == 'list')
        if operation == 'read':
            with path.open('rb') as file:
                value = file.read(512 * 1024 + 1)
            if len(value) > 512 * 1024:
                raise ValueError('File exceeds 512 KiB. Use a shell command to inspect a range.')
            return {'path': str(path.relative_to(ROOT)), 'encoding': 'base64', 'content': base64.b64encode(value).decode()}
        if operation == 'write':
            value = args.get('content')
            if not isinstance(value, str):
                raise ValueError('Provide file content.')
            data = base64.b64decode(value, validate=True) if args.get('encoding') == 'base64' else value.encode()
            if len(data) > 512 * 1024:
                raise ValueError('File exceeds 512 KiB.')
            path.parent.mkdir(parents=True, exist_ok=True)
            descriptor, temporary = tempfile.mkstemp(dir=path.parent)
            try:
                with os.fdopen(descriptor, 'wb') as file:
                    file.write(data)
                os.replace(temporary, path)
            finally:
                if os.path.exists(temporary): os.unlink(temporary)
            return {'path': str(path.relative_to(ROOT)), 'bytes': len(data)}
        if operation == 'list':
            return {'entries': [{'name': entry.name, 'directory': entry.is_dir()} for entry in sorted(path.iterdir())][:1000]}
        raise ValueError('Unknown file operation.')
    if action == 'screenshot':
        descriptor, path = tempfile.mkstemp(suffix='.png')
        os.close(descriptor)
        try:
            run('scrot', '-o', path)
            return {'mimeType': 'image/png', 'data': base64.b64encode(Path(path).read_bytes()).decode(), 'width': 1440, 'height': 1000}
        finally: os.unlink(path)
    if action == 'input':
        kind = args.get('kind')
        if kind == 'click':
            x, y, button = args.get('x'), args.get('y'), args.get('button', 1)
            if type(x) is not int or type(y) is not int or not 0 <= x < 1440 or not 0 <= y < 1000 or type(button) is not int or button not in (1, 2, 3):
                raise ValueError('Invalid click coordinates or button.')
            run('xdotool', 'mousemove', str(x), str(y), 'click', str(button))
        elif kind == 'type':
            value = args.get('text')
            if not isinstance(value, str) or len(value) > 10000 or '\x00' in value:
                raise ValueError('Invalid text, maximum 10000 characters.')
            run('xdotool', 'type', '--clearmodifiers', '--delay', '0', '--', value)
        elif kind == 'key':
            value = args.get('key')
            if not isinstance(value, str) or not re.fullmatch(r'[a-zA-Z0-9_+]{1,80}', value):
                raise ValueError('Use an X11 key combination such as ctrl+l or Return.')
            run('xdotool', 'key', '--clearmodifiers', value)
        elif kind == 'scroll':
            amount = args.get('amount')
            if type(amount) is not int or not 1 <= abs(amount) <= 20:
                raise ValueError('Scroll amount must be -20 through 20, excluding zero.')
            run('xdotool', 'click', '--repeat', str(abs(amount)), '--delay', '50', '5' if amount > 0 else '4')
        else: raise ValueError('Unknown input kind.')
        return {'ok': True}
    raise ValueError('Unknown computer action.')


if __name__ == '__main__':
    try:
        print(json.dumps(execute(sys.argv[1], json.loads(sys.argv[2])), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({'error': str(error)}))
        sys.exit(1)
