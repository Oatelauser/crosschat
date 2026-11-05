// A fixture-owned logical node process; each star uses the production NodeClient.
import assert from 'node:assert/strict';
import {mkdir,readFile,realpath} from 'node:fs/promises';
import {isAbsolute,join,relative} from 'node:path';
import process from 'node:process';
import {createLocalDiscoveryService} from '../../dist/application/discovery/local.js';
import {createNativeOperationProviders} from '../../dist/application/native-operation-providers.js';
import {listDshThreads} from '../../dist/dsh/client.js';
import {deliverToDshSession} from '../../dist/dsh/deliver.js';
import {FileInbox} from '../../dist/serve/file-channel.js';
import {attachPipePath,NodeClient} from '../../dist/serve/node.js';

assert.equal(process.env.CROSSCHAT_LIVE,'1');assert(process.send);
const [root,input]=process.argv.slice(2),owner=await readFile(join(root,'.fixture-owner'),'utf8');
assert.equal(await realpath(root),root);
const childPath=relative(root,await realpath(input));assert(childPath&&!childPath.startsWith('..')&&!isAbsolute(childPath));
const config=JSON.parse(await readFile(input,'utf8'));assert.equal(config.owner,owner);assert.equal(config.task,'c22-dsh-node');
assert(/^[a-f0-9]{32}$/u.test(config.machineId));assert.equal(await realpath(config.home),config.home);
const homePath=relative(root,config.home);assert(homePath&&!homePath.startsWith('..')&&!isAbsolute(homePath));
const baseDir=join(config.home,'.crosschat'),tcpDir=join(baseDir,'tcp'),configFile=join(tcpDir,'node.json');
const nodeConfig=JSON.parse(await readFile(configFile,'utf8'));assert.equal(nodeConfig.brokers.length,2);
const attachLabel=entry=>'c22-'+owner+'-'+config.machineId.slice(0,8)+'-'+entry.starId;
const discovery=createLocalDiscoveryService({home:config.home}),states=[];let closing;
const close=()=>closing??=(async()=>{
 const failures=[];
 for(const state of [...states].reverse()){try{await state.node.stop();await state.running;}catch(error){failures.push(error.message);}if(state.failure)failures.push(state.failure.message);}
 process.exitCode=failures.length||process.exitCode===1?1:0;process.send?.({event:'stopped',pid:process.pid,failures});if(process.connected)process.disconnect();
})();
process.on('message',message=>{if(message?.op==='stop'&&Object.keys(message).length===1)void close();});
process.once('disconnect',()=>{void close();});
try{
 await mkdir(join(baseDir,'inbox'),{recursive:true});
 for(const entry of nodeConfig.brokers){
  const node=new NodeClient({config:{entries:[entry]},configFile,machineId:()=>config.machineId,now:Date.now,log:()=>{},memberCheckMs:500,attachLabel:attachLabel(entry),
   codexHome:join(config.home,'.codex'),fileInbox:new FileInbox({inboxDir:join(baseDir,'inbox'),partsDir:join(baseDir,'parts')}),
   discover:(request,context)=>discovery.execute(request,context),operationProviders:createNativeOperationProviders({dsh:{home:config.home}}),
   makeSendDeps:()=>({env:process.env,listClaudeSessions:()=>({sessions:[],malformed:0}),listCodexThreads:async()=>[],listDshThreads:()=>listDshThreads({home:config.home}),
    deliverClaude:async()=>{throw new Error('No Claude fixture');},deliverCodex:async()=>{throw new Error('No Codex fixture');},deliverDsh:(id,body,options)=>deliverToDshSession(id,body,{...options,home:config.home}),
    sendLogFile:join(baseDir,'send-log.jsonl'),outboxDir:join(baseDir,'outbox'),now:Date.now})});
  const state={node};states.push(state);state.running=node.run().catch(error=>{state.failure=error;});await node.waitForState('online',10000);
 }
 process.send({event:'ready',pid:process.pid,machineId:config.machineId,pipes:nodeConfig.brokers.map(entry=>({starId:entry.starId,path:attachPipePath(entry,tcpDir,attachLabel(entry))}))});
}catch(error){process.send?.({event:'failure',message:error.message});process.exitCode=1;await close();}
