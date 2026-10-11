import { guest } from './guest.mjs';

// Capture the actual guest desktop, including browser chrome, dialogs and OS
// background. Never stream another workspace while its physical input runs.
const capture = String.raw`
import base64,json,os,subprocess,sys,tempfile
wanted=int(sys.argv[1])
def desktop():
 value=subprocess.check_output(['xprop','-root','_NET_CURRENT_DESKTOP'],text=True)
 return int(value.rsplit('=',1)[1].strip())
if desktop()!=wanted:
 print(json.dumps({'waiting':True}))
else:
 descriptor,path=tempfile.mkstemp(suffix='.jpg');os.close(descriptor)
 try:
  subprocess.check_call(['scrot','-o','-q','85',path],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  if desktop()!=wanted: print(json.dumps({'waiting':True}))
  else:
   with open(path,'rb') as file: data=base64.b64encode(file.read()).decode()
   print(json.dumps({'data':data,'width':1440,'height':1000}))
 finally: os.unlink(path)
`;
export class DesktopView {
  constructor(exec = guest) { this.exec = exec; this.frames = new Map(); }
  async frame(state, workspace, valid = () => true) {
    const desktop = state.workspaces.find(item => item.name === workspace)?.desktop;
    if (!Number.isInteger(desktop)) throw new Error('Unknown workspace.');
    const { stdout } = await this.exec(['python3', '-c', capture, String(desktop)]);
    const result = JSON.parse(stdout);
    if (result.data && valid()) {
      this.frames.set(workspace, { ...result, generation: state.generation });
      if (this.frames.size > 8) this.frames.delete(this.frames.keys().next().value);
      return result;
    }
    const previous = this.frames.get(workspace);
    if (previous?.generation === state.generation) return { ...previous, waiting: true };
    return { waiting: true };
  }
}
