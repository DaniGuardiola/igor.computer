import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('retiring an agent preserves windows on personal desktop and reuses its vacant slot', () => {
  const harness = String.raw`
import sys,json,tempfile
from pathlib import Path
sys.path.insert(0,'container')
import computer,windows
with tempfile.TemporaryDirectory() as directory:
 computer.STATE=Path(directory)
 (computer.STATE/'workspaces.json').write_text(json.dumps({'shared':0,'retired':1,'kept':2}))
 (computer.STATE/'workspace-labels.json').write_text(json.dumps({'retired':'old','kept':'kept'}))
 active=[1]
 entries=[dict(id='0x1',desktop=1),dict(id='0x2',desktop=2)]
 def run(*args):
  if args[:2]==('wmctrl','-d'): return '\n'.join(str(i)+' '+('*' if i==active[0] else '-')+' desktop' for i in range(3))
  if args[:2]==('wmctrl','-s'): active[0]=int(args[2])
  if args[:2]==('wmctrl','-ir'):
   next(w for w in entries if w['id']==args[2])['desktop']=int(args[4])
  assert '-ic' not in args
  return ''
 computer.run=windows.run=run
 computer.windows=windows.windows=lambda:entries
 computer.generation=lambda:'g'
 import roster
 roster.reconcile({'removed':['retired'],'profiles':[{'id':'new','label':'new agent'}]})
 data=json.loads((computer.STATE/'workspaces.json').read_text())
 assert data=={'shared':0,'kept':2,'new':1},data
 assert entries==[dict(id='0x1',desktop=0),dict(id='0x2',desktop=2)]
 assert active[0]==0
 labels=json.loads((computer.STATE/'workspace-labels.json').read_text())
 assert 'retired' not in labels and labels['new']=='new agent'
 roster.reconcile({'removed':['retired'],'profiles':[{'id':'new','label':'renamed'}]})
 assert json.loads((computer.STATE/'workspaces.json').read_text())==data
`;
  assert.doesNotThrow(() => execFileSync('python3', ['-c', harness], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }));
});
