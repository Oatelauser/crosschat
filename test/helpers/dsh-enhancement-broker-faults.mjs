// Own a loopback operator transport fault; never modify the broker or native bridge.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {WebSocket,WebSocketServer} from 'ws';
import {MAX_PAYLOAD_BYTES} from '../../dist/serve/protocol.js';

export async function withLostBrokerReceipt({home,starId,expectedPort,target,name},use){
 assert(isAbsolute(home));assert.equal(target.starId,starId);assert.equal(typeof name,'string');
 const file=join(home,'.crosschat','tcp','node.json'),original=await readFile(file),config=JSON.parse(original.toString('utf8'));
 assert(Array.isArray(config.brokers));const matches=config.brokers.filter(entry=>entry.starId===starId);assert.equal(matches.length,1);
 const entry=matches[0];assert.equal(entry.host,'127.0.0.1');assert.equal(entry.port,expectedPort);assert(Number.isInteger(expectedPort)&&expectedPort>0&&expectedPort<=65535);
 const fields=['starId','machineId','providerId','nativeId','endpointType'];
 const sameTarget=frame=>fields.every(field=>frame[field]===target[field]);
 const state={requests:0,acceptedReceipts:0,droppedReceipts:0,correlations:[],configRestored:false,proxyClosed:false};
 const sockets=new Set(),faults=[],failures=[];let dropping=true,redirected=false,proxyPort,primaryError;
 const server=new WebSocketServer({host:'127.0.0.1',port:0,maxPayload:MAX_PAYLOAD_BYTES});
 const parse=data=>{try{return JSON.parse(data.toString());}catch{return undefined;}};
 server.on('connection',downstream=>{
  const upstream=new WebSocket('ws://127.0.0.1:'+expectedPort,{maxPayload:MAX_PAYLOAD_BYTES});
  const pending=[],requests=new Map();let pendingBytes=0;
  sockets.add(downstream);sockets.add(upstream);
  const close=()=>{for(const socket of [downstream,upstream])if(socket.readyState!==WebSocket.CLOSED)socket.terminate();};
  for(const socket of [downstream,upstream]){socket.on('error',()=>{faults.push('Owned broker proxy socket error');close();});socket.once('close',()=>{sockets.delete(socket);close();});}
  const send=(socket,data,isBinary)=>{if(socket.readyState===WebSocket.OPEN)socket.send(data,{binary:isBinary},error=>{if(error){faults.push('Owned broker proxy forwarding failed');close();}});};
  downstream.on('message',(data,isBinary)=>{
   const frame=parse(data);
   if(frame?.op==='session-operation'&&sameTarget(frame)&&frame.request?.kind==='apply'&&frame.request.operation==='rename'&&frame.request.name===name){
    if(typeof frame.id!=='string'||frame.id.length===0){faults.push('Invalid operation correlation');close();return;}
    state.requests++;const correlation={id:frame.id,...Object.fromEntries(fields.map(field=>[field,target[field]]))};state.correlations.push(correlation);requests.set(frame.id,correlation);
   }
   if(upstream.readyState===WebSocket.OPEN)send(upstream,data,isBinary);
   else if(upstream.readyState===WebSocket.CONNECTING){pendingBytes+=data.byteLength;if(pendingBytes>MAX_PAYLOAD_BYTES){faults.push('Owned broker proxy queue exceeded bound');close();return;}pending.push({data,isBinary});}
  });
  upstream.once('open',()=>{for(const message of pending)send(upstream,message.data,message.isBinary);pending.length=0;pendingBytes=0;});
  upstream.on('message',(data,isBinary)=>{
   const frame=parse(data);
   if(frame?.op==='session-operation-result'&&sameTarget(frame)&&requests.has(frame.id)&&frame.result?.kind==='applied'){
    state.acceptedReceipts++;if(dropping&&state.droppedReceipts===0){state.droppedReceipts++;return;}
   }
   send(downstream,data,isBinary);
  });
 });
 server.on('error',()=>{faults.push('Owned broker proxy listener error');});
 try{
  await new Promise((done,fail)=>{server.once('listening',done);server.once('error',fail);});
  const address=server.address();assert(address&&typeof address!=='string');proxyPort=address.port;
  entry.port=proxyPort;await writeFile(file,JSON.stringify(config));redirected=true;
  await use({state,recover:()=>{dropping=false;}});
 }catch(error){primaryError=error;}finally{
  if(redirected)try{const current=JSON.parse(await readFile(file,'utf8'));assert.deepEqual(current,config);await writeFile(file,original);state.configRestored=true;}catch(error){failures.push(error);}
  try{
   const closed=new Promise(done=>server.close(done));
   const socketClosures=[...sockets].map(socket=>new Promise(done=>{if(socket.readyState===WebSocket.CLOSED){done();return;}socket.once('close',done);socket.terminate();}));
   await Promise.all([closed,...socketClosures]);state.proxyClosed=true;
  }catch(error){failures.push(error);}
  failures.push(...faults.map(message=>new Error(message)));
 }
 if(failures.length)throw new AggregateError([...(primaryError?[primaryError]:[]),...failures],'Owned broker receipt fault cleanup or forwarding failed');
 if(primaryError)throw primaryError;
 return state;
}
