// Reconcile existing guest OS workspaces under the service's desktop gate.
// Retired windows move to the personal desktop; never close tabs or reset logins.
export const rosterScript = String.raw`
import json,sys
sys.path.insert(0,'/opt/igor-computer')
from computer import STATE,workspace
from windows import windows,run
args=json.loads(sys.argv[1])
STATE.mkdir(exist_ok=True)
file=STATE/'workspaces.json'
labels_file=STATE/'workspace-labels.json'
data=json.loads(file.read_text()) if file.exists() else {'shared':0}
labels=json.loads(labels_file.read_text()) if labels_file.exists() else {}
removed=set(args['removed'])-{'shared'}
profiles=args['profiles']
if len((set(data)-removed)|{p['id'] for p in profiles})>32: raise ValueError('Maximum 32 workspaces.')
for name in removed:
 if name not in data: continue
 for window in windows():
  if window['desktop']==data[name]: run('wmctrl','-ir',window['id'],'-t',str(data['shared']))
 if any(line.split()[0]==str(data[name]) and line.split()[1]=='*' for line in run('wmctrl','-d').splitlines()): run('wmctrl','-s',str(data['shared']))
 del data[name]
 labels.pop(name,None)
for profile in profiles:
 name=profile['id']
 if name not in data: data[name]=next(index for index in range(1,32) if index not in data.values())
 labels[name]=profile['label']
for target,value in [(file,data),(labels_file,labels)]:
 temporary=target.with_suffix('.tmp')
 temporary.write_text(json.dumps(value))
 temporary.replace(target)
print(json.dumps(workspace('workspace_list',{})))
`;
