"""Capture one desktop for read-only viewers, never switching the visible desktop."""
import base64
import os
import subprocess
import tempfile


def current_desktop():
    value = subprocess.check_output(['xprop', '-root', '_NET_CURRENT_DESKTOP'], text=True)
    return int(value.rsplit('=', 1)[1].strip())


def capture(wanted):
    if current_desktop() != wanted:
        return {'waiting': True}
    descriptor, path = tempfile.mkstemp(suffix='.jpg')
    os.close(descriptor)
    try:
        subprocess.check_call(['scrot', '-o', '-q', '85', path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if current_desktop() != wanted:
            return {'waiting': True}
        with open(path, 'rb') as file:
            return {'data': base64.b64encode(file.read()).decode(), 'width': 1440, 'height': 1000}
    finally: os.unlink(path)
