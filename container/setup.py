"""Prepare /workspace from the computer definition: clone repositories, then run
devcontainer-style lifecycle commands. Runs as the unprivileged user."""
import base64
import json
import os
from pathlib import Path
import subprocess
import sys

DEFINITION = Path('/opt/igor-computer/definition.json')
ROOT = Path('/workspace')
STATE = ROOT / '.igor'


def run(command, label):
    args = command if isinstance(command, list) else ['bash', '-lc', command]
    result = subprocess.run(args, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if result.returncode != 0:
        raise RuntimeError(f'{label} failed with exit {result.returncode}: {result.stdout[-2000:]}')


def clone(repo):
    target = (ROOT / repo['path']).resolve()
    if not target.is_relative_to(ROOT): raise ValueError('Repository path must stay inside /workspace.')
    if target.exists(): return False
    args = ['git']
    token = os.environ.get('GITHUB_TOKEN') or os.environ.get('GH_TOKEN')
    # The token authenticates this clone only and never lands in .git/config.
    if token and repo['url'].startswith('https://github.com/'):
        header = base64.b64encode(('x-access-token:' + token).encode()).decode()
        args += ['-c', 'http.https://github.com/.extraheader=AUTHORIZATION: basic ' + header]
    args += ['clone', *(['--branch', repo['ref']] if repo.get('ref') else []), '--', repo['url'], str(target)]
    target.parent.mkdir(parents=True, exist_ok=True)
    run(args, 'clone ' + repo['url'])
    return True


def main():
    definition = json.loads(DEFINITION.read_text()) if DEFINITION.exists() else {}
    STATE.mkdir(parents=True, exist_ok=True)
    steps = []
    for repo in definition.get('repos', []):
        if clone(repo): steps.append('cloned ' + repo['path'])
    marker = STATE / 'setup.json'
    done = json.loads(marker.read_text()) if marker.exists() else {}
    # postCreateCommand runs once per definition revision, like a fresh devcontainer.
    if definition.get('postCreateCommand') and done.get('postCreate') != definition.get('revision'):
        run(definition['postCreateCommand'], 'postCreateCommand')
        done['postCreate'] = definition.get('revision')
        marker.write_text(json.dumps(done))
        steps.append('postCreateCommand')
    if definition.get('postStartCommand'):
        run(definition['postStartCommand'], 'postStartCommand')
        steps.append('postStartCommand')
    return {'ok': True, 'steps': steps}


if __name__ == '__main__':
    try:
        print(json.dumps(main()))
    except Exception as error:
        print(json.dumps({'error': str(error)}))
        sys.exit(1)
