import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {Guest} from '../src/guest.mjs';
import {Registry, computerContext, defaultComputer} from '../src/computers.mjs';
import {origin, stateDir} from '../src/config.mjs';
const guest=new Guest(computerContext(defaultComputer,(await new Registry().read())[defaultComputer]));
const computer=(action,args)=>guest.computer(action,args);
const token=(await readFile(stateDir+'/token','utf8')).trim();
const names=process.argv.slice(2);
assert.equal(names.length, 2, 'Provide two existing agent workspace IDs. Open your desktop first.');
assert.notEqual(names[0], names[1]);
async function rpc(path,args) {
 const response=await fetch(origin+path,{method:args===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(args===undefined?{}:{body:JSON.stringify(args)})});
 const value=await response.json(); if(!response.ok)throw new Error(value.error);return value;
}
const clients=[],pages=[];
const before=await computer('workspace_list');
const activeBefore=before.windows.find(x=>x.active)?.id;
const tool=async(client,name,args={})=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError, name + ' failed');return r;};
const text=r=>r.content.filter(x=>x.type==='text').map(x=>x.text).join('\n');
try{
 const status=await rpc('/status');assert.equal(status.mode,'human');assert.equal(status.humanWorkspace,'shared');assert.equal(status.automationPaused,false);
 for(const name of names){const client=new Client({name:'parallel-check',version:'1'});clients.push(client);await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+token,'X-Igor-Workspace':name}}}));}
 for(const name of names)assert.ok(before.workspaces.some(x=>x.name===name&&x.name!=='shared'), 'Use existing agent workspaces.');
 const results=await Promise.allSettled(clients.map(async (client,i)=>{
   const result=await tool(client,'new_page',{url:'about:blank',background:true});
   const match=text(result).match(/^(\d+):.*\[selected\]/m);assert.ok(match);pages[i]=Number(match[1]);
 }));
 for(const result of results)if(result.status==='rejected')throw result.reason;
 const after=await computer('workspace_list');
 assert.equal(after.workspaces.find(x=>x.active).name,'shared');assert.equal(after.windows.find(x=>x.active)?.id,activeBefore);
 for(let i=0;i<names.length;i++){const desktop=after.workspaces.find(x=>x.name===names[i]).desktop;assert.ok(after.windows.some(x=>x.desktop===desktop&&!before.windows.some(b=>b.id===x.id)));}
 await Promise.all(clients.map((c,i)=>tool(c,'evaluate_script',{pageId:pages[i],function:`() => { window.igorParallel = ${i}; document.body.innerHTML='<button onclick="window.clicked=true">check</button><input aria-label="value">'; return window.igorParallel; }`})));
 const start=Date.now();
 const values=await Promise.all(clients.map((c,i)=>tool(c,'evaluate_script',{pageId:pages[i],function:'() => new Promise(resolve => setTimeout(() => resolve(window.igorParallel), 1600))'})));
 const elapsed=Date.now()-start;assert.ok(elapsed<2800,`Serialized actions: ${elapsed}ms`);
 for(let i=0;i<clients.length;i++){assert.match(text(values[i]),new RegExp('\\b'+i+'\\b'));const snapshot=text(await tool(clients[i],'take_snapshot',{pageId:pages[i]}));const button=snapshot.match(/uid=(\S+) button "check"/);const input=snapshot.match(/uid=(\S+) textbox "value"/);assert.ok(button&&input,snapshot);await tool(clients[i],'fill',{pageId:pages[i],uid:input[1],value:'parallel-'+i});await tool(clients[i],'click',{pageId:pages[i],uid:button[1]});const result=text(await tool(clients[i],'evaluate_script',{pageId:pages[i],function:'() => ({clicked:window.clicked,value:document.querySelector("input").value,owner:window.igorParallel})'}));assert.match(result,/"clicked":true/);assert.match(result,new RegExp('parallel-'+i));}
 const final=await computer('workspace_list');assert.equal(final.workspaces.find(x=>x.active).name,'shared');assert.equal(final.windows.find(x=>x.active)?.id,activeBefore);
 await assert.rejects(rpc('/computer',{name:'computer_screenshot'}),/paused/);
 const isolated=await clients[0].callTool({name:'new_page',arguments:{url:'about:blank',isolatedContext:'parallel-check'}});
 assert.equal(isolated.isError, true); assert.match(text(isolated), /paused/);
 console.log(JSON.stringify({parallelAgents:2,overlapMs:elapsed,personalDesktopUnchanged:true,DOMClickAndFill:true,physicalInputBlocked:true}));
}finally{
 for(let i=0;i<clients.length;i++){if(pages[i]!==undefined)await tool(clients[i],'close_page',{pageId:pages[i]}).catch(e=>console.log('cleanup: '+e.message));await clients[i].close();}
 const after=await computer('workspace_list');
 assert.deepEqual(after.windows.map(x=>x.id).sort(),before.windows.map(x=>x.id).sort());
}
