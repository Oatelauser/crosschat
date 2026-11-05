import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {downloadDshDesktopInstaller,parseDshDesktopWindowsManifest} from '../../../scripts/dsh-compat-ci.mjs';
const cache=path.dirname(fileURLToPath(import.meta.url));
const bytes=Buffer.from('controlled official desktop installer fixture');
const version='0.2.1-rc.2';
const artifact=parseDshDesktopWindowsManifest({feed:'https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml',version,url:'https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-'+version+'-win-x64.exe',size:bytes.length,sha512:createHash('sha512').update(bytes).digest('base64')},'win32','x64');
const observations=[];
for(const blockMs of [0,200]){
  const directory=await fs.mkdtemp(path.join(cache,'late-response-fixture-'));
  if(!path.resolve(directory).startsWith(path.resolve(cache)+path.sep))throw new Error('Fixture escaped task cache');
  let canceled=false,arrive,arriveTimer;const cancellation=new Promise(resolve=>{arrive=resolve;});
  const body=new ReadableStream({cancel(){canceled=true;arrive();}});
  const fetchImpl=()=>{
    const pending=new Promise(resolve=>{arriveTimer=setTimeout(()=>resolve({ok:true,status:200,body,headers:{get(){return null;}}}),150);});
    if(blockMs)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,blockMs);
    return pending;
  };
  let guard;
  try{
    const started=Date.now();
    const error=await downloadDshDesktopInstaller(artifact,{directory,fetchImpl,timeoutMs:30}).catch(error=>error);
    const atReturn={blockMs,elapsedMs:Date.now()-started,message:error.message,undecidedResources:error.undecidedResources??[],canceledAtReturn:canceled};
    await Promise.race([cancellation,new Promise((_,reject)=>{guard=setTimeout(()=>reject(new Error('Late cancel did not finish')),2000);})]);
    observations.push({...atReturn,canceledAfterArrival:canceled,lockedAfterArrival:body.locked,remainingFiles:(await fs.readdir(directory)).length});
  }finally{clearTimeout(guard);clearTimeout(arriveTimer);await fs.rm(directory,{recursive:true,force:true});}
}
const result={node:process.version,platform:process.platform,productionCodeUnchanged:true,observations};
await fs.writeFile(path.join(cache,'late-response-repro.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result,null,2));
