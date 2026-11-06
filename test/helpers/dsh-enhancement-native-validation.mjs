// Formal Harness instances, independent node processes and two real terminal observers.
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {copyFile,mkdir,mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,resolve} from 'node:path';
import process from 'node:process';
import {fileURLToPath,URL} from 'node:url';
import {setTimeout,clearTimeout} from 'node:timers';
import {createTcpSessionOperation} from '../../dist/application/tcp/session-operations.js';
import {tcpContextId} from '../../dist/application/tcp/reading.js';
import {connectAttachPipe} from '../../dist/serve/attach-client.js';
import {Broker} from '../../dist/serve/broker.js';
import {loadBrokerFile,writeBrokerFile} from '../../dist/serve/registry.js';
import {SenderConn,requestMemberRemoveExact} from '../../dist/serve/via-tcp.js';
import {createDshFixture,pollDsh} from './dsh-live-fixture.mjs';
import {launchPty} from './tui-pty-driver.mjs';
import {withLostDshTitleReceipt} from './dsh-enhancement-faults.mjs';
import {runDshTerminalChecks} from './dsh-enhancement-terminal-checks.mjs';
import {withLostBrokerReceipt} from './dsh-enhancement-broker-faults.mjs';
import {createTcpApplication} from '../../dist/application/tcp/index.js';
import {createTcpManagement} from '../../dist/application/tcp/management.js';
import {DSH_ENHANCEMENT_SCOPE} from '../../scripts/dsh-enhancement-contract.mjs';
import {assertC22AttachPath,buildC22NodeDirectory,buildC22AttachLabel,buildC22AttachPath} from './dsh-enhancement-platform.mjs';

assert.equal(process.env.CROSSCHAT_LIVE,'1');assert.equal(process.version,'v22.23.4');
for(const name of ['DSH_C22_REPORT','DSH_RUNTIME_DIR','DSH_TASK_ROOT'])assert(isAbsolute(process.env[name]??''),name+' must be absolute');
const output=resolve(process.env.DSH_C22_REPORT),cache=dirname(output);await mkdir(cache,{recursive:true});
const parent=await realpath(process.env.DSH_TASK_ROOT),root=await realpath(await mkdtemp(join(parent,'cc-c22-'))),owner=randomUUID();
await writeFile(join(root,'.fixture-owner'),owner);
const report={schema:1,tool:'dsh-enhancement',runId:process.env.DSH_EXPECTED_RUN_ID??randomUUID(),sourceHead:process.env.DSH_PRODUCT_HEAD,
 scope:DSH_ENHANCEMENT_SCOPE,platform:process.platform,arch:process.arch,version:'0.2.1-rc.5',node:process.version,root,
 productHead:process.env.DSH_PRODUCT_HEAD,checks:[],status:'failed',stage:'setup'};
const fixtures=[],workers=[],terminals=[],pipes=[],sockets=[];let broker,unsafe=false;
const check=async(name,work)=>{report.stage='validation';report.check=name;const started=globalThis.performance.now();await work();report.checks.push({name,status:'passed',elapsedMs:Math.round(globalThis.performance.now()-started)});process.stdout.write(name+'\n');};
const bounded=(promise,milliseconds,label)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label)),milliseconds);})]).finally(()=>clearTimeout(timer));};
const readEvents=async file=>{try{return(await readFile(file,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(error){if(error.code==='ENOENT')return [];throw error;}};
const redacted=value=>{let text=value;for(const fixture of fixtures)if(fixture.info?.token)text=text.replaceAll(fixture.info.token,'[fixture-token-redacted]');return text.replace(/([?&]token=)[^&\s"'\\]+/gu,'$1[fixture-token-redacted]');};
try{
 for(let index=0;index<2;index++){
  let fixture;
  try{fixture=await createDshFixture({runtime:process.env.DSH_RUNTIME_DIR,parentRoot:root},()=>{throw new Error('Enhancement management must not call the model');});}
  catch(error){report.startupCleanup=error.cleanup;if(!error.cleanup?.runtimeStopped||!error.cleanup?.registrationRemoved||error.cleanup?.forced)unsafe=true;throw error;}
  fixtures.push(fixture);
  assert.equal(fixture.info.version,'0.2.1-rc.5');
 }
 const native=await Promise.all(fixtures.map((fixture,index)=>fixture.createSession('C22'+(index===0?'Alpha':'Beta')+Date.now())));
 const snapshots=await Promise.all(fixtures.map((fixture,index)=>fixture.snapshot(native[index].id)));
 const machineIds=['1'.repeat(32),'2'.repeat(32)],stars=['c22-alpha','c22-beta'];
 const keys=stars.map(()=>Array.from({length:4},()=>randomBytes(32).toString('hex')));
 const registryFile=join(root,'broker.json');
 writeBrokerFile(registryFile,{stars:stars.map((starId,index)=>({starId,name:starId,nodes:keys[index].map((key,k)=>({label:'c22-role-'+k,key,addedAt:new Date().toISOString()})),roster:[]}))});
 broker=new Broker({registryFile,statusFile:join(root,'broker-status.json'),port:0,version:'c22-owned-native',machineId:()=>'3'.repeat(32),hostname:()=>'C22-owned',now:Date.now,log:()=>{},heartbeatMs:60000,deliverLocal:async()=>{throw new Error('No broker local delivery');}});
 const port=await broker.start();
 const entriesFor=role=>stars.map((starId,index)=>({host:'127.0.0.1',port,key:keys[index][role],name:starId,starId}));
 const roster=star=>loadBrokerFile(registryFile).stars.find(s=>s.starId===star).roster;
 const member=(star,index)=>roster(star).find(m=>m.machine===machineIds[index]&&m.sessionId===native[index].id&&m.tool==='dsh'&&m.endpointType==='host');
 for(let index=0;index<2;index++){
  const fixture=fixtures[index],tcp=buildC22NodeDirectory(root,index);await mkdir(tcp,{recursive:true});await writeFile(join(tcp,'node.json'),JSON.stringify({brokers:entriesFor(index)}));
  for(const entry of entriesFor(index))buildC22AttachPath(process.platform,tcp,buildC22AttachLabel(owner,machineIds[index],entry.starId));
  const input=join(root,'node-'+index+'.json');await writeFile(input,JSON.stringify({task:'c22-dsh-node',owner,home:await realpath(fixture.env.HOME),tcpDir:tcp,machineId:machineIds[index]}),{mode:0o600});
  const child=fork(fileURLToPath(new URL('./dsh-enhancement-node.mjs',import.meta.url)),[root,input],{env:{...fixture.env,CROSSCHAT_LIVE:'1'},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  const state={child,index,stdout:'',stderr:'',messages:[]};workers.push(state);
  child.stdout.on('data',chunk=>{state.stdout=(state.stdout+chunk).slice(-32000);});child.stderr.on('data',chunk=>{state.stderr=(state.stderr+chunk).slice(-32000);});
  child.on('message',message=>state.messages.push(message));state.exited=new Promise(done=>child.once('close',(code,signal)=>done({code,signal})));child.once('error',error=>{state.error=error;});
  state.ready=await pollDsh(()=>{if(state.error)throw Object.assign(state.error,{terminal:true});const failed=state.messages.find(m=>m.event==='failure');if(failed)throw Object.assign(new Error(failed.message),{terminal:true});if(child.exitCode!==null)throw Object.assign(new Error('Owned node exited: '+state.stderr),{terminal:true});return state.messages.find(m=>m.event==='ready');},'independent node '+index+' online',20000);
 }
 assert.notEqual(workers[0].child.pid,workers[1].child.pid);assert.notEqual(fixtures[0].pid,fixtures[1].pid);
 assert.equal(new Set(workers.flatMap(worker=>worker.ready.pipes.map(pipe=>pipe.path))).size,4,'Logical nodes require distinct owned attach namespaces on this shared Windows host');
 for(const pipe of workers.flatMap(worker=>worker.ready.pipes))assertC22AttachPath(pipe.path,process.platform);
 report.identities=workers.map((worker,index)=>({nodePid:worker.child.pid,hostPid:fixtures[index].pid,machineId:machineIds[index],nativeId:native[index].id,instanceVersion:fixtures[index].info.version}));
 const operators=[];
 for(let index=0;index<2;index++){
  const home=join(root,'operator-'+index),tcp=join(home,'.crosschat','tcp');await mkdir(tcp,{recursive:true});await writeFile(join(tcp,'node.json'),JSON.stringify({brokers:entriesFor(index+2)}));
  operators.push({home,operate:createTcpSessionOperation({baseDir:join(home,'.crosschat'),timeoutMs:10000})});
 }
 const target=(index,star=stars[0],nativeId=native[index].id)=>({contextId:'local',starId:star,machineId:machineIds[index],providerId:'dsh',nativeId,endpointType:'host'});
 const describe=async(index,star=stars[0],operator=0)=>(await operators[operator].operate(target(index,star),{kind:'describe'})).description;
 const adopt=async(index,star=stars[0],operator=0)=>{const d=await describe(index,star,operator);assert.equal(d.actions.adopt.state,'executable');return operators[operator].operate(target(index,star),{kind:'apply',operation:'adopt',expectedRevision:d.revision});};
 await check('two-node-identities-and-remote-exact-source-isolation',async()=>{
  for(let index=0;index<2;index++){assert.equal((await describe(index)).actions.rename.state,'executable');const wrong=await operators[0].operate(target(1-index,stars[0],native[index].id),{kind:'describe'});assert.equal(wrong.description.actions.adopt.state,'unavailable');}
  assert.equal(roster(stars[0]).length,0);assert.equal(roster(stars[1]).length,0);
 });
 await check('two-independent-terminal-observers-open-the-same-authoritative-star',async()=>{
  for(let index=0;index<2;index++){
   const input=join(root,'terminal-'+index+'.json'),events=join(root,'terminal-'+index+'.jsonl'),label='C22-OPERATOR-'+index;await writeFile(input,JSON.stringify({task:'c22-dsh-terminal',home:operators[index].home,owner,contexts:[{id:tcpContextId(entriesFor(index+2)[0]),kind:'tcp',label}]}));
   const pty=await launchPty({executable:process.execPath,args:[fileURLToPath(new URL('./dsh-native-members-pty.mjs',import.meta.url)),root,input,events],env:{...fixtures[index].env,HOME:operators[index].home,USERPROFILE:operators[index].home},columns:140,rows:36,logPath:join(cache,'terminal-'+index+'.jsonl')});
   const terminal={pty,events,index};terminals.push(terminal);await pty.waitForOutput(label);let mark=pty.output.length;pty.write(':stars\r');await pty.waitForOutput(stars[0],10000,mark);mark=pty.output.length;pty.write('/'+stars[0]+'\r');await pty.waitForOutput(/1\/1/u,10000,mark);mark=pty.output.length;pty.write('\r');await pty.waitForOutput('按在线 / 下线分组',10000,mark);
   await pollDsh(async()=>(await readEvents(events)).some(e=>e.event==='read'&&e.resource==='members'),'terminal member page ready',10000);
  }
 });
 const expectTerminals=async(names)=>{
  await Promise.all(terminals.map(async terminal=>{const events=(await readEvents(terminal.events)).length;await pollDsh(async()=>(await readEvents(terminal.events)).slice(events).some(e=>e.event==='read'&&e.resource==='members'&&names.every(name=>JSON.stringify(e.page).includes(name))),'independent terminal background refresh',15000);for(const name of names)await terminal.pty.waitForOutput(name,10000);}));
 };
 await check('explicit-adoption-refreshes-both-operators-and-isolates-the-other-star',async()=>{
  assert.equal((await adopt(0)).result.kind,'applied');assert.equal((await adopt(1,stars[0],1)).result.kind,'applied');
  await pollDsh(()=>member(stars[0],0)&&member(stars[0],1),'both exact authoritative members');await expectTerminals(native.map(n=>n.title));assert.equal(roster(stars[1]).length,0);
 });
 const window=async(index,star)=>{const path=workers[index].ready.pipes.find(p=>p.starId===star).path,pipe=await connectAttachPipe(path);pipes.push(pipe);return pipe;};
 const declaration=index=>({sessionId:native[index].id,tool:'dsh',endpointType:'host',name:native[index].title,temporary:true,selectionOwned:true});
 await check('permanent-membership-survives-two-temporary-window-claims-and-erase-release',async()=>{
  const first=await window(0,stars[0]),second=await window(0,stars[0]);
  for(const [pipe,claimId] of [[first,'permanent-window-a'],[second,'permanent-window-b']])assert.equal((await pipe.send({op:'attach',...declaration(0),claimId})).ok,true);
  await pollDsh(()=>member(stars[0],0)?.temporary!==true,'permanent membership remains permanent');
  assert.equal((await first.send({op:'detach',...declaration(0),claimId:'permanent-window-a',erase:true})).ok,true);
  assert.equal((await second.send({op:'detach',...declaration(0),claimId:'permanent-window-b',erase:true})).ok,true);
  await pollDsh(()=>member(stars[0],0)&&member(stars[0],0).temporary!==true,'permanent roster protected after final temporary window');
 });
 await check('temporary-window-release-is-exact-and-independent-across-stars',async()=>{
  const first=await window(0,stars[1]),second=await window(0,stars[1]);
  for(const [pipe,claimId] of [[first,'temporary-window-a'],[second,'temporary-window-b']])assert.equal((await pipe.send({op:'attach',...declaration(0),claimId})).ok,true);
  await pollDsh(()=>member(stars[1],0)?.temporary===true,'temporary second-star member');
  assert.equal((await first.send({op:'detach',...declaration(0),claimId:'temporary-window-a',erase:true})).ok,true);assert.equal(member(stars[1],0)?.temporary,true);
  assert.equal((await second.send({op:'detach',...declaration(0),claimId:'temporary-window-b',erase:true})).ok,true);
  await pollDsh(()=>!member(stars[1],0),'last temporary claim removes only second-star roster');assert(member(stars[0],0));assert(member(stars[0],1));
 });
 await check('native-rename-syncs-both-operators-without-changing-the-other-node',async()=>{
  const description=await describe(0,stars[0],1),name='C22Renamed'+Date.now();
  const result=await operators[1].operate(target(0),{kind:'apply',operation:'rename',name,expectedRevision:description.revision});assert.equal(result.result.kind,'applied');
  await pollDsh(()=>member(stars[0],0)?.name===name,'renamed authoritative member');await expectTerminals([name,native[1].title]);
  const after=await fixtures[0].snapshot(native[0].id);assert.equal(after.sameAgent,true);assert.deepEqual(after.events.slice(0,snapshots[0].events.length),snapshots[0].events);assert.equal(after.events.length,snapshots[0].events.length+1);assert.equal(after.events.at(-1).type,'session/title');
  assert.deepEqual((await fixtures[1].snapshot(native[1].id)).events,snapshots[1].events);report.renamed=name;
 });
 await check('lost-native-write-receipt-is-uncertain-and-readonly-recovery-never-replays',async()=>{
  const name='C22LostAck'+Date.now(),before=await fixtures[0].snapshot(native[0].id);
  report.nativeReceiptFault=await withLostDshTitleReceipt({home:fixtures[0].env.HOME,expectedPid:fixtures[0].pid},async fault=>{
   const description=await describe(0),result=await operators[0].operate(target(0),{kind:'apply',operation:'rename',name,expectedRevision:description.revision});
   assert.equal(result.result.kind,'uncertain');assert.equal(fault.state.titlePosts,1);assert.equal(fault.state.acceptedWrites,1);assert.equal(fault.state.droppedReceipts,1);report.lostReceiptResult=result.result;
   const after=await fixtures[0].snapshot(native[0].id);assert.equal(after.sameAgent,true);assert.deepEqual(after.events.slice(0,before.events.length),before.events);assert.equal(after.events.length,before.events.length+1);assert.equal(after.events.at(-1).type,'session/title');
   fault.recover();for(let index=0;index<2;index++)assert.equal((await describe(0,stars[0],index)).actions.rename.state,'executable');await expectTerminals([name,native[1].title]);
   assert.equal(fault.state.titlePosts,1);assert.equal((await fixtures[0].snapshot(native[0].id)).events.length,after.events.length);assert.deepEqual((await fixtures[1].snapshot(native[1].id)).events,snapshots[1].events);report.renamed=name;
  });
  assert.equal(report.nativeReceiptFault.registrationRestored,true);assert.equal(report.nativeReceiptFault.proxyClosed,true);
 });
 await check('lost-broker-receipt-is-uncertain-and-other-operator-observes-one-write',async()=>{
  const name='C22Broker'+String(Date.now()).slice(-6),before=await fixtures[0].snapshot(native[0].id);
  const faultHome=join(root,'operator-fault'),faultTcp=join(faultHome,'.crosschat','tcp');await mkdir(faultTcp,{recursive:true});await copyFile(join(operators[0].home,'.crosschat','tcp','node.json'),join(faultTcp,'node.json'));
  report.brokerReceiptFault=await withLostBrokerReceipt({home:faultHome,starId:stars[0],expectedPort:port,target:target(0),name},async fault=>{
   const baseDir=join(faultHome,'.crosschat'),catalog=createTcpApplication({baseDir});
   const management=createTcpManagement({baseDir,catalog,operateSession:createTcpSessionOperation({baseDir,timeoutMs:10000})});
   const proxyConfig=JSON.parse(await readFile(join(baseDir,'tcp','node.json'),'utf8'));
   const request={contextId:tcpContextId(proxyConfig.brokers[0]),starId:stars[0],action:'rename-session',sessionTarget:{machineId:machineIds[0],providerId:'dsh',nativeId:native[0].id,endpointType:'host'},values:{name}};
   const preview=await management.preview(request);assert.equal(preview.enabled,true,JSON.stringify(preview));
   const result=await management.apply({...request,expectedPreviewRevision:preview.revision});assert.equal(result.kind,'uncertain');report.lostBrokerResult=result;
   assert.equal(fault.state.requests,1);assert.equal(fault.state.acceptedReceipts,1);assert.equal(fault.state.droppedReceipts,1);assert.equal(fault.state.correlations.length,1);
   await pollDsh(()=>member(stars[0],0)?.name===name,'broker committed exact renamed member');
   assert.equal((await describe(0,stars[0],1)).actions.rename.state,'executable');await expectTerminals([name,native[1].title]);
   const after=await fixtures[0].snapshot(native[0].id);assert.equal(after.sameAgent,true);assert.deepEqual(after.events.slice(0,before.events.length),before.events);assert.equal(after.events.length,before.events.length+1);assert.equal(after.events.at(-1).type,'session/title');
   fault.recover();for(let index=0;index<2;index++)assert.equal((await describe(0,stars[0],index)).actions.rename.state,'executable');
   await expectTerminals([name,native[1].title]);assert.equal(fault.state.requests,1);assert.equal((await fixtures[0].snapshot(native[0].id)).events.length,after.events.length);
   assert.deepEqual((await fixtures[1].snapshot(native[1].id)).events,snapshots[1].events);report.renamed=name;
  });
  assert.equal(report.brokerReceiptFault.configRestored,true);assert.equal(report.brokerReceiptFault.proxyClosed,true);
 });
 await check('bridge-loss-and-recovery-stay-local-and-reject-old-confirmations',async()=>{
  const original=await describe(0);await fixtures[0].controller('/bridge',{enabled:false});assert.equal((await describe(0)).actions.adopt.state,'unavailable');assert.equal((await describe(1)).actions.adopt.state,'executable');
  await fixtures[0].controller('/bridge',{enabled:true});const recovered=await pollDsh(async()=>{const d=await describe(0);return d.actions.adopt.state==='executable'&&d;},'source recovery');assert.notEqual(recovered.revision,original.revision);
  const result=await operators[0].operate(target(0),{kind:'apply',operation:'rename',name:'must-not-replay',expectedRevision:original.revision});assert.equal(result.result.kind,'rejected');assert.equal(member(stars[0],0).name,report.renamed);assert.equal((await fixtures[0].snapshot(native[0].id)).sameAgent,true);
 });
 await check('cross-operator-confirmation-recovery-and-keyboard-selection-stay-exact',async()=>{
  await runDshTerminalChecks({terminals,fixtures,native,machineIds,stars,operators,target,describe,member,expectTerminals,report,readEvents,pollDsh});
 });
 await check('exact-removal-does-not-change-other-node-or-native-chat',async()=>{
  const conn=await SenderConn.open('ws://127.0.0.1:'+port,keys[0][3],undefined,10000);sockets.push(conn);
  assert.equal((await requestMemberRemoveExact(conn,{sessionId:native[0].id,machine:machineIds[0],tool:'dsh',endpointType:'host'},10000)).ok,true);await pollDsh(()=>!member(stars[0],0),'selected exact roster removed');assert(member(stars[0],1));
  const first=await fixtures[0].snapshot(native[0].id),second=await fixtures[1].snapshot(native[1].id);assert.equal(first.sameAgent,true);assert.equal(second.sameAgent,true);assert.equal(first.events.length,snapshots[0].events.length+5);assert.deepEqual(second.events,snapshots[1].events);assert.equal(fixtures[0].model.requests.length,0);assert.equal(fixtures[1].model.requests.length,0);
 });
 report.rosters=stars.map(starId=>({starId,members:roster(starId)}));report.status='passed';report.stage='done';delete report.check;
}catch(error){report.category=report.stage==='setup'||error.category==='infrastructure'?'infrastructure':'validation-failed';report.error={name:error.name,message:error.message,stack:error.stack};}
finally{
 const failures=[];
 for(const terminal of terminals){
  try{if(terminal.pty){terminal.pty.write('\x1b');await new Promise(done=>setTimeout(done,100));terminal.pty.write('q');const exited=await bounded(terminal.pty.exited,10000,'Terminal did not exit');assert.deepEqual(exited,{code:0,hostCode:0});
   if(process.platform!=='win32'){terminal.transportCleanup=terminal.pty.events.find(e=>e.event==='cleanup');assert.equal(terminal.transportCleanup?.groupReleased,true,'POSIX terminal process group release is unconfirmed');assert.equal(terminal.transportCleanup.forced,false,'POSIX terminal required forced cleanup');}
   const event=(await readEvents(terminal.events)).find(e=>e.event==='exit');assert(event);assert.deepEqual(event.after,event.before);terminal.exit=event;await terminal.pty.dispose();}}catch(error){unsafe=true;failures.push(error.message);try{await terminal.pty?.dispose();}catch(failure){failures.push(failure.message);}}
  try{await copyFile(terminal.events,join(cache,'terminal-'+terminal.index+'-application.jsonl'));}catch(error){failures.push(error.message);}
 }
 report.terminals=terminals.map(t=>({index:t.index,exit:t.exit,transportCleanup:t.transportCleanup}));
 for(const pipe of pipes)try{pipe.close();}catch(error){failures.push(error.message);}for(const socket of sockets)try{socket.close();}catch(error){failures.push(error.message);}
 for(const worker of workers){try{if(worker.child.connected)worker.child.send({op:'stop'});worker.exit=await bounded(worker.exited,15000,'Node release unconfirmed');assert.deepEqual(worker.exit,{code:0,signal:null});}catch(error){unsafe=true;failures.push(error.message);try{worker.child.kill();await bounded(worker.exited,5000,'Forced node release unconfirmed');}catch(failure){failures.push(failure.message);}}}
 report.nodes=workers.map(w=>({index:w.index,pid:w.child.pid,exit:w.exit,messages:w.messages,stdout:redacted(w.stdout),stderr:redacted(w.stderr)}));
 try{await broker?.stop();}catch(error){unsafe=true;failures.push(error.message);}
 report.hosts=[];
 for(const fixture of [...fixtures].reverse()){
  try{if(unsafe)await fixture.stop();else await fixture.close();}catch(error){unsafe=true;failures.push(error.message);}
  report.hosts.push({pid:fixture.pid,cleanup:fixture.cleanup,logs:{stdout:redacted(fixture.logs.stdout),stderr:redacted(fixture.logs.stderr)}});
 }
 if(failures.length){report.status='failed';report.stage='cleanup';report.category='infrastructure';report.error??={message:failures.join('; ')};}report.cleanupFailures=failures;report.unsafe=unsafe;
 await writeFile(output,redacted(JSON.stringify(report,null,2))+'\n');
 if(!unsafe){try{const actual=await realpath(root),inside=relative(parent,actual);assert.equal(actual,root);assert(inside&&!inside.startsWith('..')&&!isAbsolute(inside));assert.equal(await readFile(join(root,'.fixture-owner'),'utf8'),owner);await rm(root,{recursive:true,force:true});report.outerRemoved=true;}catch(error){report.outerRemoved=false;report.cleanupFailures.push(error.message);report.status='failed';}await writeFile(output,redacted(JSON.stringify(report,null,2))+'\n');}
}
process.stdout.write(JSON.stringify({status:report.status,checks:report.checks.length,error:report.error?.message,outerRemoved:report.outerRemoved,unsafe:report.unsafe})+'\n');
assert.equal(report.status,'passed',report.error?.message??report.cleanupFailures?.join('; '));
