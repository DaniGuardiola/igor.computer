import test from 'node:test';
import { execFileSync } from 'node:child_process';

test('guest workspaces preserve the user desktop, labels and general application windows', () => {
  execFileSync('python3', ['-c', `
import sys, tempfile, json
from pathlib import Path
sys.path.insert(0, 'container')
import computer, windows
with tempfile.TemporaryDirectory() as directory:
 computer.ROOT = Path(directory)
 computer.STATE = computer.ROOT / '.igor'
 active = [0]
 commands = []
 def run(*args):
  commands.append(args)
  if args[:2] == ('wmctrl', '-d'): return '\\n'.join(str(i)+' '+('*' if i == active[0] else '-')+' desktop' for i in range(3))
  if args[:2] == ('wmctrl', '-s'): active[0] = int(args[2])
  return ''
 computer.run = run
 computer.generation = lambda: 'generation'
 computer.windows = lambda: []
 result = computer.workspace('workspace_list', {})
 assert result['workspaces'][0] == dict(name='shared', label='user', desktop=0, active=True)
 computer.workspace('workspace_create', dict(name='agent-1', label='ivo'))
 result = computer.workspace('workspace_create', dict(name='notes', label='research'))
 assert result['workspaces'][1]['label'] == 'ivo'
 result = computer.workspace('workspace_select', dict(name='user'))
 assert result['workspaces'][0]['active']
 assert len(result['workspaces']) == 3
 result = computer.workspace('workspace_select', dict(name='notes'))
 assert result['workspaces'][2]['active']
 assert json.loads((computer.STATE/'workspace-labels.json').read_text())['notes'] == 'research'
entries = [dict(id='0x1', desktop=0, active=True), dict(id='0x2', desktop=1, active=False)]
windows.windows = lambda: entries
windows.generation = lambda: 'generation'
commands = []
def run(*args):
 commands.append(args)
 if args[:2] == ('wmctrl', '-d'): return '0 * desktop\\n1 - desktop'
 return ''
windows.run = run
windows.execute('restore', '', 'generation')
assert ('wmctrl', '-ia', '0x1') in commands
assert not any('0x2' in command for command in commands)
# The real enumerator must retain a terminal, not only Chromium.
from importlib import reload
windows = reload(windows)
def enumeration(*args):
 if args[:2] == ('wmctrl', '-lpG'): return '0x00000001 0 1 0 0 640 480 host Terminal'
 if args[:2] == ('xprop', '-root'): return '_NET_ACTIVE_WINDOW = 0x1'
 return 'WM_CLASS = "xterm", "XTerm"'
windows.run = enumeration
assert windows.windows()[0]['title'] == 'Terminal'
`], { stdio: 'pipe', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
});


test('saved workspace beyond Openbox defaults restores desktops before selection', () => {
  execFileSync('python3', ['-c', `
import sys, tempfile, json
from pathlib import Path
sys.path.insert(0, 'container')
import computer
with tempfile.TemporaryDirectory() as directory:
 computer.STATE = Path(directory)
 (computer.STATE / 'workspaces.json').write_text(json.dumps({'shared': 0, 'doc': 4}))
 active, count, pending = [0], [4], [False]
 commands = []
 def run(*args):
  commands.append(args)
  if args[:2] == ('wmctrl', '-n'): pending[0] = True
  if args[:2] == ('wmctrl', '-d'):
   if pending[0]: count[0] = 5; pending[0] = False
   return '\\n'.join(str(i)+' '+('*' if i == active[0] else '-')+' desktop' for i in range(count[0]))
  if args[:2] == ('wmctrl', '-s') and int(args[2]) < count[0]: active[0] = int(args[2])
  return ''
 computer.run = run
 computer.generation = lambda: 'g'
 computer.windows = lambda: []
 result = computer.workspace('workspace_select', {'name': 'doc'})
 assert result['workspaces'][1]['active']
 assert commands.index(('wmctrl', '-n', '5')) < commands.index(('wmctrl', '-s', '4'))
 computer.workspace('workspace_list', {})
 assert commands.count(('wmctrl', '-n', '5')) == 1
`], { stdio: 'pipe', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
});
