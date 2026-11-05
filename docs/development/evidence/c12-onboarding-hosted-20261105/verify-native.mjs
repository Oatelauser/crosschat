import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseDshNpmManifest, hasDshRuntimeReleaseProof } from '../../../scripts/dsh-compat-ci.mjs';
import { validDshOnboardingProcessReport, DSH_ONBOARDING_CHECKS } from '../../../scripts/dsh-onboarding-contract.mjs';
const cache=path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u,'$1'));
const head='0d0f91a81bbb7264cd2bca830013d64b40fa2c0a';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const pin=read('scripts/dsh-compat-baseline.json');
const uuid=new Set();const verified=[];
for(const directory of fs.readdirSync(path.join(cache,'inspection'))) {
  const match=/^dsh-onboarding-(win32|linux|darwin)-(x64|arm64)$/u.exec(directory);assert.ok(match,'Unexpected target');
  const target={platform:match[1],arch:match[2]};const root=path.join(cache,'inspection',directory);
  const index=read(path.join(root,'index.json'));assert.equal(new Set(index.members.map(item=>item.file)).size,index.members.length);
  for(const item of index.members){const bytes=fs.readFileSync(path.join(root,item.file));assert.equal(bytes.length,item.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256);}
  const summary=read(path.join(root,'summary.json'));
  assert.equal(summary.tool,'dsh-onboarding');assert.equal(summary.platform,target.platform);assert.equal(summary.arch,target.arch);
  assert.deepEqual(summary.classification,{kind:'compatible',notify:false});assert.equal(summary.installationCleanup,'removed');assert.equal(summary.retry,undefined);
  assert.equal(summary.npmCache.external,false);assert.equal(summary.npmCache.disposition,'removed-with-task-root');
  assert.deepEqual(summary.builds.baseline,parseDshNpmManifest(pin.package,target.platform,target.arch));
  const attempts=[];
  for(const label of ['baseline','candidate']) {
    const artifact=summary.builds[label],report=summary[label];
    assert.deepEqual(artifact,parseDshNpmManifest({name:artifact.name,version:artifact.version,dist:{tarball:artifact.url,integrity:artifact.integrity}},target.platform,target.arch));
    assert.equal(artifact.version,label==='baseline'?'0.2.1-rc.2':'0.2.1-rc.5');
    assert.equal(validDshOnboardingProcessReport(report,artifact,target),true);assert.equal(hasDshRuntimeReleaseProof(report.cleanup),true);
    assert.equal(uuid.has(report.runId),false);uuid.add(report.runId);
    const entries=index.members.filter(item=>item.file.startsWith(label+'-')&&item.file.endsWith('/report.json'));assert.equal(entries.length,1);
    const attemptRoot=path.join(root,path.dirname(entries[0].file));
    const raw=read(path.join(attemptRoot,'report.json'));const {process:processResult,...withoutProcess}=report;assert.deepEqual(raw,withoutProcess);
    for(const file of ['process.json','install-skills.json','update-skills.json','remove-plugin.json','uninstall-crosschat-data.json']){
      const child=read(path.join(attemptRoot,file));assert.equal(child.code,0,file);assert.equal(child.signal,null,file);assert.equal(child.timedOut,false,file);
    }
    assert.deepEqual(raw.source,{status:'identified',sourceTool:'dsh',basis:'native',association:'verified',scope:'instance',shouldAsk:false});
    const native=read(path.join(attemptRoot,'native-skill-and-identity.json'));assert.equal(native.skillIssued,true);assert.equal(native.identityIssued,true);assert.deepEqual(native.source,raw.source);
    assert.ok(native.results.length>=2&&native.results.every(item=>item.is_error===false));
    const lock=read(path.join(root,label+'-package-lock.json')).packages['node_modules/@deepseek-ai/dsh'];
    const tarballKey=createHash('sha256').update(artifact.integrity).digest('hex');
    assert.equal(lock.version,artifact.version);assert.equal(lock.resolved,'file:../'+tarballKey+'.tgz');assert.equal(lock.integrity,artifact.integrity);
    const retained=read(path.join(attemptRoot,'retained-profile-chat-hashes.json'));
    assert.equal(retained.nativeSessionIds.length,2);assert.equal(retained.contentMarkers.length,3);assert.match(retained.profileSha256,/^[a-f0-9]{64}$/u);assert.ok(Object.keys(retained.chatFiles).length>=2);
    const events=fs.readFileSync(path.join(attemptRoot,'tui-application.jsonl'),'utf8').split(/\r?\n/u).filter(Boolean).map(line=>JSON.parse(line));
    for(const event of ['sessions','clipboard','doctor','maintenance','members','exit'])assert.ok(events.some(item=>item.event===event),event);
    const exit=events.findLast(item=>item.event==='exit');assert.equal(exit.code,0);assert.deepEqual(exit.after,exit.before);
    const terminalEvents=fs.readFileSync(path.join(attemptRoot,'tui-terminal.jsonl'),'utf8').split(/\r?\n/u).filter(Boolean).map(line=>JSON.parse(line));
    assert.equal(terminalEvents.findLast(item=>item.direction==='host'&&item.event==='exit')?.code,0);
    assert.equal(terminalEvents.findLast(item=>item.direction==='driver'&&item.event==='host-exit')?.code,0);
    if(target.platform!=='win32'){assert.equal(raw.terminal.kind,'posix-pty');assert.deepEqual(raw.terminal.cleanup,{event:'cleanup',forced:false,groupReleased:true});}
    attempts.push({label,version:artifact.version,integrity:artifact.integrity,runId:report.runId,checks:report.checks.map(item=>item.name),source:raw.source,cleanup:raw.cleanup,terminal:raw.terminal,process:processResult});
  }
  let terminalPreflight;
  if(target.platform!=='win32'){
    const preflight=read(path.join(root,'terminal-preflight/report.json'));
    assert.equal(preflight.platform,target.platform);assert.equal(preflight.arch,target.arch);assert.equal(preflight.status,'passed');assert.equal(preflight.checks.length,7);assert.ok(preflight.checks.every(item=>item.status==='passed'));
    terminalPreflight=preflight;
  }
  verified.push({target,members:index.members.length,checksPerVersion:DSH_ONBOARDING_CHECKS.length,classification:summary.classification,installationCleanup:summary.installationCleanup,npmCache:summary.npmCache,attempts,terminalPreflight});
}
const paths=read('docs/development/evidence/c12-posix-onboarding-20261105/native-source-correlation.json').nativeFiles.map(item=>item.file);
paths.push('.github/workflows/dsh-onboarding-compat.yml');
const git=args=>execFileSync('git',args,{encoding:'utf8',windowsHide:true}).trim();
const correlation=paths.map(file=>({file,executed:git(['rev-parse',head+':'+file]),current:git(['hash-object',file])}));
assert.ok(correlation.every(item=>item.executed===item.current));
assert.equal(git(['diff','--name-only','a1e6464bd6eb28f12f51609cd637dd8518c5222b','--','src','package.json','package-lock.json']),'');
const result={schema:1,verifiedAt:new Date().toISOString(),executedHead:head,run:41978059319,attempt:1,targets:verified,sourceCorrelation:correlation,srcAndPackageFilesUnchangedFromMain:true};
const output=path.join(cache,'native-verification-'+verified.length+'-terminal.json');
if(!fs.existsSync(output))fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({targets:verified.map(item=>item.target),versions:2,checksPerVersion:6,uniqueRunIds:uuid.size,sourceBlobs:correlation.length,allChecksPassed:true}));
