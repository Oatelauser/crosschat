import {fileURLToPath, URL} from 'node:url';
import process from 'node:process';
import {setTimeout, clearTimeout} from 'node:timers';
import {createDshOwnedNode} from './dsh-owned-node.mjs';
import {launchPty} from './tui-pty-driver.mjs';
import {loadBrokerFile} from '../../dist/serve/registry.js';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {copyFile,mkdir,mkdtemp,readFile,realpath,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {createDshFixture,pollDsh,runDshCommand} from './dsh-live-fixture.mjs';
import {connectDesktopCDP} from './opencode-desktop-cdp.mjs';
assert.equal(process.env.CROSSCHAT_LIVE,'1');assert.equal(process.version,'v22.23.4');

assert.equal(process.platform,'win32');
for(const name of ['DSH_NATIVE_RENAME_REPORT','DSH_RUNTIME_DIR','DSH_TASK_ROOT','DSH_BROWSER_EXECUTABLE'])assert(process.env[name],name+' is required');
const output=resolve(process.env.DSH_NATIVE_RENAME_REPORT),cache=dirname(output);await mkdir(cache,{recursive:true});
const install={runtime:resolve(process.env.DSH_RUNTIME_DIR)};
const root=await realpath(await mkdtemp(join(await realpath(process.env.DSH_TASK_ROOT),'cc-c20-web-')));
const report={schema:1,scope:'Windows rc.5 real Web UI, production Node/Broker, ConPTY rename, roster and typed by-name delivery',root,status:'failed',productHead:process.env.DSH_PRODUCT_HEAD};
let fixture,child,childExit,browser,page,debugPort,node,pty,terminalEvents,unsafe=false,browserLogs='';
const redact=s=>s.replace(/([?&]token=)[^&\s"'\\]+/g,'$1[fixture-token-redacted]');
const ownedBrowserProcesses=async()=>{
 const result=await runDshCommand('pwsh',['-NoProfile','-NonInteractive','-Command',"$p=[Environment]::GetEnvironmentVariable('C20_BROWSER_ROOT'); @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(?:msedge|chrome)' -and $_.CommandLine -and $_.CommandLine.Contains($p) }).Count"],{cwd:root,env:{...fixture.env,C20_BROWSER_ROOT:root},timeout:10000});
 assert.equal(result.code,0);const count=Number(result.stdout.trim());assert(Number.isSafeInteger(count)&&count>=0);return count;
};
try{
 fixture=await createDshFixture({runtime:install.runtime,parentRoot:root,registerWorkspace:true},()=>({text:'C20 mock ACK'}));report.version=fixture.info.version;report.hostPid=fixture.pid;
 const native=await fixture.createSession('C20 Before '+Date.now());report.nativeId=native.id;await fixture.prompt(native.id,'C20 owned initial conversation');await fixture.idle(native.id);report.initialModelRequests=fixture.model.requests.length;const before=await fixture.snapshot(native.id);
 const health=await fixture.controller('/health'),match=/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/.exec(fixture.logs.stdout);assert(match,'Official owned Web URL is required');const url=new URL(match[1]);assert.equal(Number(url.port),health.webPort);
 const profile=join(fixture.root,'edge-profile');await mkdir(profile);
 child=spawn(process.env.DSH_BROWSER_EXECUTABLE,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--disable-sync','--disable-component-update','--enable-logging=stderr','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{cwd:fixture.root,env:fixture.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 report.browser='existing Playwright Chromium 1243';report.browserPid=child.pid;child.stdout.on('data',c=>{browserLogs=(browserLogs+c).slice(-32000)});child.stderr.on('data',c=>{browserLogs=(browserLogs+c).slice(-32000)});
 let spawnError;child.once('error',e=>{spawnError=e});childExit=new Promise(done=>child.once('close',(code,signal)=>done({code,signal})));
 const active=await pollDsh(async()=>{if(spawnError)throw Object.assign(spawnError,{terminal:true});if(child.exitCode!==null)throw Object.assign(new Error('Owned browser exited before readiness: '+browserLogs.slice(-1000)),{terminal:true});try{return await readFile(join(profile,'DevToolsActivePort'),'utf8')}catch(e){if(e.code==='ENOENT')return;throw e;}},'owned Edge debugging endpoint',20000);
 const [port,path]=active.trim().split(/\r?\n/);debugPort=Number(port);assert(Number.isSafeInteger(debugPort)&&debugPort>0&&debugPort<65536);assert(/^\/devtools\/browser\/[a-f0-9-]+$/.test(path));
 const listener=await runDshCommand('pwsh',['-NoProfile','-NonInteractive','-Command',"Get-NetTCPConnection -LocalPort $env:C20_DEBUG_PORT -State Listen | Select-Object -ExpandProperty OwningProcess"],{cwd:root,env:{...fixture.env,C20_DEBUG_PORT:String(debugPort)},timeout:10000});assert.equal(listener.code,0);assert.equal(Number(listener.stdout.trim()),child.pid);report.browserEndpointOwnerVerified=true;
 browser=await connectDesktopCDP('ws://127.0.0.1:'+debugPort+path);
 const created=await browser.send('Target.createTarget',{url:url.href});
 const pages=await(await globalThis.fetch('http://127.0.0.1:'+debugPort+'/json/list',{signal:globalThis.AbortSignal.timeout(5000)})).json();const tab=pages.find(p=>p.id===created.targetId);assert(tab&&typeof tab.webSocketDebuggerUrl==='string');
 page=await connectDesktopCDP(tab.webSocketDebuggerUrl);await page.send('Page.enable');
 const text=()=>page.evaluate('document.body?.innerText ?? ""');
 report.setup=await fixture.controller('/health');report.browserVersion=await browser.send('Browser.getVersion');
 const click=async(selector)=>{
  const point=await page.evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e||["添加工作区","选择工作区"].includes(e.getAttribute("aria-label")))return null;e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');assert(point&&point.x>=0&&point.y>=0,'Owned visible UI target is required; native folder pickers are excluded');
  await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 };
 await pollDsh(()=>page.evaluate('Boolean(document.querySelector(\'button[aria-label="新建会话"]\'))'),'native Web controls',15000);
 await pollDsh(()=>page.evaluate('[...document.querySelectorAll("button")].some(e=>e.innerText==="继续")'),'fresh native preview acknowledgement',15000);
 if(await page.evaluate('[...document.querySelectorAll("button")].some(e=>e.innerText==="继续")')){
  await page.evaluate('[...document.querySelectorAll("button")].find(e=>e.innerText==="继续").setAttribute("data-c20-continue","true")');await click('button[data-c20-continue]');
 }
 await pollDsh(()=>page.evaluate('!document.querySelector("button[data-c20-continue]")'),'native preview closed',10000);
 await page.evaluate('document.querySelector(\'button[aria-label="打开侧边栏"]\')?.click()');
 await pollDsh(()=>page.evaluate('Boolean(document.querySelector(\'button[aria-label="收起侧边栏"]\'))'),'native sidebar open',10000);

 await pollDsh(async()=>{const body=await text();report.lastBody=body.slice(-12000);return body.includes(native.title)},'native title rendered in true Web UI',20000);
 await page.screenshot(join(cache,'native-rename-before.png'));
 report.beforeTitleVisible=true;

 const rowSelector='[data-row-key='+JSON.stringify('session:'+native.id)+']';await click(rowSelector);
 await pollDsh(()=>page.evaluate('document.querySelector('+JSON.stringify(rowSelector)+')?.getAttribute("aria-selected")==="true"'),'exact existing native session selected in Web UI',10000);
 assert.equal((await fixture.snapshot(native.id)).sameAgent,true);report.selectedExactNativeId=native.id;


 await writeFile(join(fixture.root,'ownership.json'),JSON.stringify({task:'c20-dsh-native-rename',root:fixture.root}));
 node=await createDshOwnedNode({root:fixture.root,home:fixture.env.HOME,env:fixture.env,nativeId:native.id,endpointType:'host',nativeOperations:true});
 const roster=()=>loadBrokerFile(node.registryFile).stars.find(star=>star.starId===node.starId).roster;
 await pollDsh(()=>roster().some(member=>member.sessionId===native.id),'initial exact star membership');
 const name='C20After'+Date.now();report.newName=name;
 const input=join(fixture.root,'terminal-input.json');terminalEvents=join(fixture.root,'terminal-events.jsonl');
 await writeFile(input,JSON.stringify({home:fixture.env.HOME,owner:await readFile(join(fixture.root,'.fixture-owner'),'utf8')}));
 const events=async()=>{try{return(await readFile(terminalEvents,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse)}catch(error){if(error.code==='ENOENT')return [];throw error;}};
 const event=(predicate,after=0)=>pollDsh(async()=>(await events()).slice(after).find(predicate),'native rename terminal event',10000);
 pty=await launchPty({executable:process.execPath,args:[fileURLToPath(new URL('./dsh-native-members-pty.mjs',import.meta.url)),fixture.root,input,terminalEvents],env:fixture.env,columns:140,rows:36,logPath:join(cache,'native-rename-terminal.jsonl')});
 const send=async(keys,expected)=>{const mark=pty.output.length;pty.write(keys);if(expected)await pty.waitForOutput(expected,10000,mark);};
 await pty.waitForOutput('C18-NATIVE-MEMBERS');await send(':stars\r','C09-OWNED-STAR');await send('\r','按在线 / 下线分组');
 await event(entry=>entry.event==='availability'&&entry.result['rename-session']?.enabled);
 await send('e','原生会话新名称');const afterCancel=(await events()).length;await send('\x1b','已取消操作');
 assert(!(await events()).some(entry=>entry.event==='mutation'));assert.equal(roster()[0].name,native.title);
 await event(entry=>entry.event==='availability'&&entry.result['rename-session']?.enabled,afterCancel);
 const reopened=(await events()).length;await send('e','原生会话新名称');
 await event(entry=>entry.event==='preview'&&entry.action==='rename-session'&&entry.result.enabled,reopened);await send(name,name);
 await send('\t\t\r');report.terminalMutation=await event(entry=>entry.event==='mutation'&&entry.action==='rename-session');
 await pollDsh(()=>roster().some(member=>member.sessionId===native.id&&member.name===name),'renamed authoritative native star member');
 report.roster=roster();report.sameAgent=(await fixture.snapshot(native.id)).sameAgent;assert.equal(report.sameAgent,true);
 const renamedSnapshot=await fixture.snapshot(native.id);assert.deepEqual(renamedSnapshot.events.slice(0,before.events.length),before.events);assert.equal(renamedSnapshot.events.length,before.events.length+1);assert.equal(renamedSnapshot.events.at(-1).type,'session/title');
 report.titleEvent=renamedSnapshot.events.at(-1);report.modelCallsAtRename=fixture.model.requests.length;assert.equal(report.modelCallsAtRename,report.initialModelRequests);
 let outputMark=pty.output.length;pty.resize(48,16);await pty.waitForOutput('CC · 工作区',10000,outputMark);outputMark=pty.output.length;pty.resize(140,36);await pty.waitForOutput('CC · 工作区',10000,outputMark);
 await send('q');assert.deepEqual(await pty.exited,{code:0,hostCode:0});const exit=await event(entry=>entry.event==='exit');assert.deepEqual(exit.after,exit.before);report.terminalExit=exit;await pty.dispose();pty=undefined;
 const delivery=await fixture.cli(['send','--via','tcp:'+node.starId+':'+node.machineId+':'+name,'--tool','dsh','--body','C20 controlled by-name delivery']);report.byNameDelivery=delivery;assert.equal(delivery.code,0);assert.equal(delivery.timedOut,false);
 await fixture.idle(native.id);assert(JSON.stringify((await fixture.snapshot(native.id)).events).includes('C20 controlled by-name delivery'));report.deliverySameAgent=(await fixture.snapshot(native.id)).sameAgent;assert.equal(report.deliverySameAgent,true);
 await pollDsh(async()=>{const body=await text();report.lastBody=body.slice(-12000);return body.includes(name)&&!body.includes(native.title)},'native UI rename without reload',15000);
 report.afterTitleVisible=true;report.selectedAfter=await page.evaluate('document.querySelector('+JSON.stringify(rowSelector)+')?.getAttribute("aria-selected")==="true"');assert.equal(report.selectedAfter,true);report.sameAgent=(await fixture.snapshot(native.id)).sameAgent;assert.equal(report.sameAgent,true);report.nativeEventsBefore=before.events;report.nativeEventsAfter=(await fixture.snapshot(native.id)).events;report.finalModelRequests=fixture.model.requests.length;
 await page.screenshot(join(cache,'native-rename-after.png'));report.status='passed';
}catch(error){report.error={message:error.message,stack:error.stack};}
finally{
 const failures=[];
 try{await pty?.dispose()}catch(error){unsafe=true;failures.push(error.message)}
 if(terminalEvents){try{await copyFile(terminalEvents,join(cache,'native-rename-terminal-application.jsonl'))}catch(error){failures.push(error.message)}}
 try{await node?.close()}catch(error){unsafe=true;failures.push(error.message)}
 try{await page?.close()}catch(e){failures.push(e.message)}
 if(browser){try{await browser.send('Browser.close',{},5000)}catch(e){report.browserCloseTransport=e.code??e.message;}try{await browser.close()}catch(e){failures.push(e.message)}}
 if(child){let timer;try{report.browserExit=await Promise.race([childExit,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Owned browser release is unknown')),10000)})]);assert.equal(report.browserExit.code,0);assert.equal(report.browserExit.signal,null);}catch(e){unsafe=true;failures.push(e.message);try{child.kill();report.browserForced=true;let forcedTimer;try{report.forcedBrowserExit=await Promise.race([childExit,new Promise(done=>{forcedTimer=setTimeout(()=>done(null),5000)})]);}finally{clearTimeout(forcedTimer);}}catch{ /* Unknown release retains this owned root. */ }}finally{clearTimeout(timer)}
  try{report.browserProcessesAfter=await ownedBrowserProcesses();if(report.browserProcessesAfter!==0){unsafe=true;failures.push('Owned browser descendants remain')}}catch(e){unsafe=true;failures.push(e.message)}
 }
 if(fixture){report.nativeLogs={stdout:redact(fixture.logs.stdout),stderr:redact(fixture.logs.stderr)};try{if(unsafe)await fixture.stop();else await fixture.close()}catch(e){unsafe=true;failures.push(e.message)}report.cleanup=fixture.cleanup;}
 if(failures.length){report.status='failed';report.cleanupFailures=failures;}
 report.browserLogs=browserLogs;report.unsafe=unsafe;await writeFile(output,redact(JSON.stringify(report,null,2))+'\n');
}
process.stdout.write(JSON.stringify({status:report.status,error:report.error?.message,cleanup:report.cleanup,browserExit:report.browserExit,browserProcessesAfter:report.browserProcessesAfter,unsafe})+'\n');
assert.equal(report.status,'passed');
