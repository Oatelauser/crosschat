import fs from 'node:fs';
import { once } from 'node:events';
import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { queryDoctorDiagnostics } from '../../../dist/application/diagnostics/query.js';
const observations=[];
for(const ready of [false,true]) for(let sample=0;sample<6;sample++) {
  const started=performance.now();let online;
  const worker=new Worker('require("node:worker_threads").parentPort.postMessage("ready");Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);',{eval:true});
  worker.once('online',()=>{online=performance.now()-started;});
  let outer;
  try {
    if(ready)await once(worker,'message',{signal:AbortSignal.timeout(2000)});
    const queryStarted=performance.now();
    const result=await Promise.race([
      queryDoctorDiagnostics({timeoutMs:20,createWorker:()=>worker}).then(()=>'healthy',error=>error.name),
      new Promise(resolve=>{outer=setTimeout(()=>resolve('still-running'),250);}),
    ]);
    observations.push({ready,sample,onlineMs:online??null,queryAndReapMs:performance.now()-queryStarted,result,threadIdAtResult:worker.threadId});
  } finally {clearTimeout(outer);await worker.terminate();}
}
const result={node:process.version,platform:process.platform,queryDeadlineMs:20,completionGuardMs:250,observations};
fs.writeFileSync(new URL('timing-probe.json',import.meta.url),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result,null,2));
