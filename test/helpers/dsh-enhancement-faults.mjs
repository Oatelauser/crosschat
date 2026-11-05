// Own one temporary registration redirect and HTTP fault in an isolated native profile.
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {URL} from 'node:url';
import {readDshRegistrations} from '../../dist/dsh/registry.js';

export async function withLostDshTitleReceipt({home,expectedPid},use){
 const registrations=await readDshRegistrations({home},globalThis.AbortSignal.timeout(5000));assert.equal(registrations.length,1);
 const registration=registrations[0];assert.equal(registration.pid,expectedPid);
 const file=join(home,'.crosschat','dsh','instances',registration.instanceId+'.json'),original=await readFile(file);
 const controllers=new Set(),pending=new Set(),cleanupFailures=[];let dropping=true,redirected=false,proxyURL,primaryError;
 const state={titlePosts:0,acceptedWrites:0,droppedReceipts:0,readonlyRequests:0,registrationRestored:false,proxyClosed:false};
 const server=createServer((request,response)=>{
  const work=(async()=>{
   if(request.headers.origin!==undefined||request.headers.authorization!=='Bearer '+registration.token){response.writeHead(401);response.end('{}');request.resume();return;}
   assert(request.method==='GET'||request.method==='POST');const path=request.url??'';assert(path.startsWith('/v1/'));
   const titleWrite=request.method==='POST'&&/^\/v1\/sessions\/[^/]+\/title$/u.test(path);if(titleWrite)state.titlePosts++;else state.readonlyRequests++;
   const body=[];let bytes=0;for await(const part of request){bytes+=part.byteLength;assert(bytes<=4096);body.push(part);}
   const controller=new globalThis.AbortController();controllers.add(controller);
   const abort=()=>controller.abort();request.once('aborted',abort);
   try{
    const upstream=await globalThis.fetch(new URL(path,registration.url),{method:request.method,headers:{authorization:'Bearer '+registration.token,accept:'application/json',...(request.method==='POST'?{'content-type':'application/json'}:{})},...(request.method==='POST'?{body:Buffer.concat(body)}:{}),signal:globalThis.AbortSignal.any([controller.signal,globalThis.AbortSignal.timeout(10000)]),redirect:'error'});
    const chunks=[];let count=0;for await(const chunk of upstream.body){count+=chunk.byteLength;assert(count<=1024*1024);chunks.push(Buffer.from(chunk));}const text=Buffer.concat(chunks).toString('utf8');
    if(titleWrite&&upstream.ok){assert.equal(JSON.parse(text).accepted,true);state.acceptedWrites++;if(dropping){state.droppedReceipts++;return;}}
    if(!response.destroyed){response.writeHead(upstream.status,{'content-type':'application/json'});response.end(text);}
   }finally{controllers.delete(controller);request.removeListener('aborted',abort);}
  })().catch(error=>{if(!response.destroyed&&!response.headersSent){response.writeHead(502);response.end(JSON.stringify({error:error.message}));}});
  pending.add(work);void work.finally(()=>pending.delete(work));
 });
 try{
  await new Promise((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',done);});const address=server.address();assert(address&&typeof address!=='string');proxyURL='http://127.0.0.1:'+address.port;
  await writeFile(file,JSON.stringify({...registration,url:proxyURL}));redirected=true;
  await use({state,recover:()=>{dropping=false;}});
 }catch(error){primaryError=error;}finally{
  if(redirected){try{const current=JSON.parse(await readFile(file,'utf8'));assert.equal(current.instanceId,registration.instanceId);assert.equal(current.token,registration.token);assert.equal(current.pid,registration.pid);assert.equal(current.url,proxyURL);await writeFile(file,original);state.registrationRestored=true;}catch(error){cleanupFailures.push(error);}}
  try{const closed=new Promise(done=>server.close(done));for(const controller of controllers)controller.abort();server.closeAllConnections();await Promise.allSettled([...pending]);await closed;state.proxyClosed=true;}catch(error){cleanupFailures.push(error);}
 }
 if(cleanupFailures.length)throw new AggregateError([...(primaryError?[primaryError]:[]),...cleanupFailures],'Owned fault proxy cleanup failed');
 if(primaryError)throw primaryError;
 return state;
}
