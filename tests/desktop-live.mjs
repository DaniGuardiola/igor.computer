// Exercise the installed browser and desktop APIs on a disposable task tab.
// Requires an idle service in agent mode; never bypasses human ownership.
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { stateDir, origin } from '../src/config.mjs';
const token = (await readFile(stateDir + '/token', 'utf8')).trim();
const headers={Authorization:'Bearer '+token,'X-Igor-Workspace':'verification','X-Igor-Workspace-Label':'verification'};
const client=new Client({name:'igor-desktop-live',version:'1'});
await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers}}));
function data(r){if(r.isError)throw Error(r.content.find(x=>x.type==='text')?.text);if(r.structuredContent)return r.structuredContent;const t=r.content.find(x=>x.type==='text')?.text;try{return JSON.parse(t)}catch{return t}}
async function tool(name,args={}){const r=await client.callTool({name,arguments:args},undefined,{timeout:120000});if(r.isError)throw Error(name+': '+r.content.find(x=>x.type==='text')?.text);return r}
const fixture='<!doctype html><title>igor desktop verification</title><input aria-label="desktop verification text"><button onclick="window.igorDesktopClicked=true">desktop verification button</button>';
let pid,pageId,leased=false;
const turnId='desktop-verification-'+Date.now();
try{
 const status=data(await tool('browser_status'));
 if(status.mode!=='agent'||status.busy||status.runtime.activeTurns)throw Error('Computer is in use. Finish the current turn or human takeover before testing.');
 await tool('computer_begin_turn',{turnId});leased=true;
 const tools=(await client.listTools()).tools;
 if(!tools.some(t=>t.name==='new_page')||!tools.some(t=>t.name==='computer_ui_get_app_state'))throw Error('Separate browser/desktop APIs missing');
 const command=`python3 - <<'PY'\nimport pathlib,subprocess\np=pathlib.Path('/tmp/igor-desktop-fixture');p.mkdir(exist_ok=True);(p/'index.html').write_text(${JSON.stringify(fixture)})\npid=subprocess.Popen(['python3','-m','http.server','19082','--bind','127.0.0.1','--directory',str(p)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True).pid\nprint(pid)\nPY`;
 pid=Number(data(await tool('computer_exec',{command})).stdout.trim());
 const pages=await tool('new_page',{url:'http://127.0.0.1:19082/',background:false});
 pageId=Number(pages.content.find(x=>x.type==='text').text.match(/(\d+):.*\[selected\]/)?.[1]);
 if(!pageId)throw Error('Browser page not selected');
 const dom=await tool('take_snapshot',{pageId});
 if(!JSON.stringify(dom).includes('desktop verification button'))throw Error('Direct browser snapshot failed');
 console.log('PASS browser API: navigation and DOM snapshot independent of desktop tools');
 const doctor=data(await tool('computer_ui_doctor'));
 console.log('desktop readiness',JSON.stringify(doctor.readiness));
 const state=await tool('computer_ui_get_app_state',{include_screenshot:false,max_nodes:2000});
 const parsed=data(state);
 if(!parsed.tree_scoped)throw Error('Accessibility tree was not scoped to the target window');
 console.log('fixture accessibility nodes',parsed.accessibility_tree?.filter(n=>n.name?.includes('desktop verification')).length);
 const valueResult=await client.callTool({name:'computer_ui_set_value',arguments:{name:'desktop verification text',value:'a11y input works'}});
 if(valueResult.isError){
  await tool('computer_ui_click',{name:'desktop verification text'});
  await tool('computer_ui_type_text',{text:'a11y input works'});
 }
 await tool('computer_ui_perform_action',{name:'desktop verification button'});
 const checked=await tool('evaluate_script',{pageId,function:'() => ({typed:document.querySelector("input").value,clicked:window.igorDesktopClicked===true})'});
 if(!JSON.stringify(checked).includes('a11y input works')||!checked.content.find(x=>x.type==='text')?.text.includes('"clicked":true'))throw Error('Desktop semantic actions failed verification');
 console.log('PASS desktop accessibility: field lookup, typing fallback and semantic button action verified via browser API');
 const shot=await tool('computer_ui_screenshot',{max_width:720});
 const image=shot.content.find(x=>x.type==='image');
 if(!image||Buffer.from(image.data,'base64').subarray(1,4).toString()!=='PNG')throw Error('Desktop screenshot missing PNG image');
 console.log('PASS desktop screenshot through native MCP image content');
}finally{
 if(pageId){try{await tool('close_page',{pageId})}catch{}}
 if(pid){try{await tool('computer_exec',{command:'kill '+pid+'; rm -rf /tmp/igor-desktop-fixture'})}catch{}}
 if(leased){try{await tool('computer_end_turn',{turnId})}catch{}}
 await client.close();
}
