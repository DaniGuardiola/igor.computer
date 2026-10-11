import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { guest, computer } from './guest.mjs';

// Desktop entries are installed guest applications. gio handles Exec field codes;
// clients never supply commands or host paths.
const script = String.raw`
import configparser,json,sys,subprocess,time,base64
from pathlib import Path
sys.path.insert(0,'/opt/igor-browser')
from windows import windows,run
apps=[]
for file in sorted(Path('/usr/share/applications').glob('*.desktop')):
 if file.name == 'x11vnc.desktop': continue
 try:
  config=configparser.ConfigParser(interpolation=None,strict=False)
  config.read(file)
  item=config['Desktop Entry']
  if item.get('Type')!='Application' or any(item.get(k,'false').lower()=='true' for k in ['Hidden','NoDisplay','Terminal']): continue
  if not item.get('Exec'): continue
  icon=item.get('Icon','')
  paths=[Path(icon)] if icon.startswith('/') else [Path('/usr/share/icons/hicolor')/size/'apps'/(icon+'.png') for size in ['64x64','48x48','256x256','32x32']] + [Path('/usr/share/pixmaps')/(icon+'.png')]
  image=next((p for p in paths if p.is_file() and p.stat().st_size<100000),None)
  apps.append({'id':file.name,'name':'chromium' if file.name=='chromium.desktop' else item.get('Name',file.stem).lower(),'icon':('data:image/png;base64,'+base64.b64encode(image.read_bytes()).decode()) if image else None})
 except (KeyError,ValueError,OSError,configparser.Error): pass
args=json.loads(sys.argv[1])
if args.get('action')=='launch':
 app=next((a for a in apps if a['id']==args.get('id')),None)
 if not app: raise ValueError('Application no longer installed.')
 before={w['id'] for w in windows()}
 subprocess.Popen(['gio','launch',str(Path('/usr/share/applications')/app['id'])],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
 for _ in range(60):
  fresh=[w for w in windows() if w['id'] not in before]
  if fresh:
   for w in fresh: run('wmctrl','-ir',w['id'],'-t',str(args['desktop']))
   run('wmctrl','-ia',fresh[0]['id'])
   break
  time.sleep(.1)
 else:
  run('wmctrl','-s',str(args['desktop']))
  raise ValueError('Application did not open a window.')
print(json.dumps({'apps':apps}))
`;
export class Desktop {
  constructor(directory, operations = { guest, computer }) { this.operations = operations; this.file = join(directory, 'desktop.json'); this.writes = Promise.resolve(); }
  async preferences() {
    try { return JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return { pins: ['chromium.desktop'], profiles: {} }; }
  }
  async update(change) {
    const next = this.writes.then(async () => {
      const value = await this.preferences();
      change(value);
      await writeFile(this.file + '.tmp', JSON.stringify(value), { mode: 0o600 });
      await rename(this.file + '.tmp', this.file);
      return value;
    });
    this.writes = next.catch(() => {});
    return next;
  }
  async catalog() {
    if (!this.cached || Date.now() - this.cached.at > 30000) {
      const { stdout } = await this.operations.guest(['python3', '-c', script, '{}']);
      this.cached = { at: Date.now(), apps: JSON.parse(stdout).apps };
    }
    return { apps: this.cached.apps, pins: (await this.preferences()).pins };
  }
  async pin(ids) {
    const { apps } = await this.catalog();
    if (!Array.isArray(ids) || ids.length > 24 || new Set(ids).size !== ids.length || ids.some(id => !apps.some(app => app.id === id))) throw new Error('Choose installed applications.');
    await this.update(value => { value.pins = ids; });
    return this.catalog();
  }
  async launch(id, newWindow = false) {
    const { apps } = await this.catalog();
    if (!apps.some(app => app.id === id)) throw new Error('Application no longer installed.');
    const state = await this.operations.computer('workspace_list');
    const workspace = state.workspaces.find(item => item.active);
    if (id === 'chromium.desktop') return this.operations.computer('workspace_open_browser', { name: workspace.name, reuse: !newWindow });
    await this.operations.guest(['python3', '-c', script, JSON.stringify({ action: 'launch', id, desktop: workspace.desktop })]).catch(() => { throw new Error('The app did not open a window in this workspace.'); });
    return computer('workspace_list');
  }
  async profile(name, profile) {
    if (!/^[a-zA-Z0-9_-]{1,60}$/.test(name) || typeof profile.label !== 'string' || !profile.label.trim() || profile.label.length > 80) throw new Error('Invalid workspace profile.');
    const avatar = profile.avatar ?? null;
    if (avatar !== null && (typeof avatar !== 'string' || avatar.length > 14 * 1024 * 1024 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(avatar))) throw new Error('Use a PNG, JPEG or WebP workspace picture.');
    await this.update(value => { value.profiles ??= {}; value.profiles[name] = { label: profile.label.trim(), avatar }; });
    return { ok: true };
  }
  async workspaces(state) {
    const { profiles = {} } = await this.preferences();
    return { ...state, workspaces: state.workspaces.map(item => ({ ...item, ...profiles[item.name] })) };
  }
}
