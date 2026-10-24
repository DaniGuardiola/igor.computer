import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Desktop } from '../src/desktop.mjs';

test('pins persist and accept only installed app IDs, not commands or paths', async () => {
 const root=await mkdtemp(join(tmpdir(),'igor-desktop-'));
 try {
  const operations={computer:async()=>({apps:[{id:'chromium.desktop',name:'Chromium'},{id:'editor.desktop',name:'Editor'}]})};
  const desktop=new Desktop(root,operations);
  assert.deepEqual((await desktop.catalog()).pins,['chromium.desktop']);
  await desktop.pin(['editor.desktop','chromium.desktop']);
  assert.deepEqual((await new Desktop(root,operations).catalog()).pins,['editor.desktop','chromium.desktop']);
  await assert.rejects(desktop.pin(['../../bad.desktop']));
  await assert.rejects(desktop.pin(['chromium.desktop','chromium.desktop']));
  await desktop.pin([]);assert.deepEqual((await desktop.catalog()).pins,[]);
 } finally { await rm(root,{recursive:true,force:true}); }
});
test('profile updates preserve stable workspace identity, desktop and windows', async()=>{
 const root=await mkdtemp(join(tmpdir(),'igor-profile-'));
 try {
  const desktop=new Desktop(root);
  const state={workspaces:[{name:'agent-1',label:'old',desktop:3,active:true}],windows:[{id:'0x7'}]};
  await desktop.profile('agent-1',{label:'new',avatar:'data:image/png;base64,YQ=='});
  const value=await desktop.workspaces(state);
  assert.deepEqual(value.workspaces[0],{name:'agent-1',label:'new',desktop:3,active:true,avatar:'data:image/png;base64,YQ==',personal:false});
  assert.deepEqual(value.windows,state.windows);
  await desktop.profile('agent-1',{label:'newer',avatar:null});
  assert.equal((await desktop.workspaces(state)).workspaces[0].avatar,null);
  await assert.rejects(desktop.profile('agent-1',{label:'bad',avatar:'https://external/image.png'}));
 } finally { await rm(root,{recursive:true,force:true}); }
});
test('Chromium launcher reuses browser in currently selected workspace',async()=>{
 const root=await mkdtemp(join(tmpdir(),'igor-launch-'));const calls=[];
 try {
  const desktop=new Desktop(root,{computer:async(action,args)=>{calls.push([action,args]);return action==='apps'?{apps:[{id:'chromium.desktop'}]}:{workspaces:[{name:'agent-2',desktop:4,active:true}]}}});
  await desktop.launch('chromium.desktop');
  assert.deepEqual(calls[2],['workspace_open_browser',{name:'agent-2',reuse:true}]);
  await assert.rejects(desktop.launch('arbitrary-command'));
 }finally{await rm(root,{recursive:true,force:true})}
});
test('agent roster retires only its owned workspaces and validates before guest changes', async () => {
 const root=await mkdtemp(join(tmpdir(),'igor-roster-'));const calls=[];
 try {
  const desktop=new Desktop(root,{computer:async(action,args)=>{calls.push(args);return {}}});
  const owner='a'.repeat(64),other='b'.repeat(64);
  await desktop.reconcile(owner,[{id:'agent-1',label:'first',avatar:null},{id:'agent-2',label:'second',avatar:null}]);
  await desktop.reconcile(other,[{id:'agent-2',label:'second',avatar:null}]);
  await desktop.reconcile(owner,[{id:'agent-1',label:'renamed',avatar:null}]);
  assert.deepEqual(calls.at(-1).removed,[]);
  await desktop.reconcile(other,[]);
  assert.deepEqual(calls.at(-1).removed,['agent-2']);
  const count=calls.length;
  await assert.rejects(desktop.reconcile(owner,[{id:'agent-1',label:'ok'},{id:'shared',label:'bad'}]));
  await assert.rejects(desktop.reconcile(owner,[{id:'agent-1',label:'ok',avatar:'https://external'}]));
  assert.equal(calls.length,count);
  const state=await desktop.workspaces({workspaces:[{name:'shared',label:'user',desktop:0},{name:'agent-1',desktop:1}],windows:[]});
  assert.deepEqual(state.workspaces[0],{name:'shared',label:'your desktop',desktop:0,avatar:null,personal:true});
  assert.equal(state.workspaces[1].label,'renamed');
 }finally{await rm(root,{recursive:true,force:true})}
});
