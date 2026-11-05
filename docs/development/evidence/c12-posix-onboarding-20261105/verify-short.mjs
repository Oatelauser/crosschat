import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {validDshOnboardingProcessReport,DSH_ONBOARDING_CHECKS} from '../../../scripts/dsh-onboarding-contract.mjs';
import {parseDshNpmManifest,parsePnpmManifest} from '../../../scripts/dsh-compat-ci.mjs';
const cache=new URL('./',import.meta.url);const read=file=>JSON.parse(fs.readFileSync(new URL(file,cache),'utf8'));
const directory='linux-short-inspection/';const summary=read(directory+'summary.json');const disposition=read('linux-short-disposition.json');
const pinned=JSON.parse(fs.readFileSync('scripts/dsh-compat-baseline.json','utf8'));const target={platform:'linux',arch:'x64'};
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const normal=value=>value?.code===0&&value.signal===null&&value.timedOut===false;
const problems=[];const attempts=[];
if(summary.platform!==target.platform||summary.arch!==target.arch||summary.classification?.kind!=='compatible'||summary.classification.notify!==false||summary.installationCleanup!=='removed'||summary.retry||summary.retainedInstallation||summary.retainedTaskRoot||summary.error||summary.cleanupError||summary.npmCache?.external!==false||summary.npmCache.disposition!=='removed-with-task-root')problems.push('Summary/installation/cache result is not a direct full pass');
if(disposition.innerRootExists!==false||disposition.npmCacheExists!==false||disposition.installationCleanup!=='removed'||disposition.processesMatchingOwnedRoots.length!==0||!disposition.scope.includes('same WSL execution'))problems.push('Same-execution OS cleanup observations disagree');
const expectedBaseline=parseDshNpmManifest(pinned.package,target.platform,target.arch);const expectedPnpm=parsePnpmManifest(pinned.packageManager);
if(canonical(summary.builds.baseline)!==canonical(expectedBaseline)||canonical(summary.builds.packageManager)!==canonical(expectedPnpm))problems.push('Pinned baseline/package manager identity changed');
const skill=(fs.readFileSync('skills/crosschat/SKILL.md','utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'').trim().replaceAll('\r\n','\n'));
for(const label of ['baseline','candidate']){
  const report=summary[label];const build=summary.builds[label];
  try{parseDshNpmManifest({...build,dist:{tarball:build.url,integrity:build.integrity}},target.platform,target.arch);}catch{problems.push(label+' artifact identity invalid');}
  if(!validDshOnboardingProcessReport(report,build,target)||report.status!=='passed'||report.checks.length!==6)problems.push(label+' complete native report is invalid');
  const raw=read(directory+label+'-report.json');const process=read(directory+label+'-process.json');const install=read(directory+label+'-install.json');const lock=read(directory+label+'-package-lock.json');
  const {process:ignored,...body}=report;
  if(canonical(raw)!==canonical(body)||!normal(process)||!normal(install))problems.push(label+' raw report/process/install correlation differs');
  for(const [name,artifact]of[['@deepseek-ai/dsh',build],['pnpm',summary.builds.packageManager]]){
    const actual=lock.packages?.['node_modules/'+name];if(actual?.version!==artifact.version||actual.integrity!==artifact.integrity)problems.push(label+' lock differs for '+name);
  }
  const native=read(directory+label+'-native-skill-and-identity.json');
  if(native.skillIssued!==true||native.identityIssued!==true||native.source?.status!=='identified'||native.source.sourceTool!=='dsh'||native.source.basis!=='native'||native.source.association!=='verified'||canonical(native.source)!==canonical(report.source)||!JSON.stringify(native.results).replaceAll('\\r\\n','\\n').includes(JSON.stringify(skill).slice(1,-1)))problems.push(label+' actual full skill/native source proof differs');
  const doctor=read(directory+label+'-doctor-json.json');const checks=doctor.groups.flatMap(group=>group.checks);
  if(!['harness-bridge-ready','harness-profile-plugin-ready'].every(code=>checks.some(check=>check.code===code))||!checks.some(check=>check.code==='skill-match'&&check.data.side==='harness'))problems.push(label+' diagnostic facts missing');
  const application=fs.readFileSync(new URL(directory+label+'-tui-application.jsonl',cache),'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  const events=fs.readFileSync(new URL(directory+label+'-tui-terminal.jsonl',cache),'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  const exit=application.find(event=>event.event==='exit');const terminal=events.find(event=>event.direction==='host'&&event.event==='cleanup');
  if(exit?.code!==0||canonical(exit.before)!==canonical(exit.after)||application.filter(event=>event.event==='clipboard').length!==2||!application.some(event=>event.event==='maintenance'&&event.result.status==='complete')||!application.some(event=>event.event==='members'&&event.page.rows.length===1)||terminal?.forced!==false||terminal.groupReleased!==true||report.terminal?.kind!=='posix-pty'||canonical(report.terminal.cleanup)!==canonical({event:terminal.event,forced:terminal.forced,groupReleased:terminal.groupReleased})||!events.some(event=>event.direction==='host'&&event.event==='exit'&&event.code===0)||!events.some(event=>event.event==='host-exit'&&event.code===0))problems.push(label+' real TUI operations/release/restoration not proven');
  const output=Buffer.concat(events.filter(event=>event.direction==='host'&&event.event==='output').map(event=>Buffer.from(event.data,'base64'))).toString('utf8');
  for(const mode of ['1049','2004'])if(output.lastIndexOf(`\x1b[?${mode}h`)<0||output.lastIndexOf(`\x1b[?${mode}l`)<=output.lastIndexOf(`\x1b[?${mode}h`))problems.push(label+' terminal mode '+mode+' not restored');
  const chats=read(directory+label+'-retained-profile-chat-hashes.json');
  const prefix='c11_'+report.runId.slice(0,8)+'_';
  if(!/^[a-f0-9]{64}$/u.test(chats.profileSha256)||chats.nativeSessionIds.length!==2||new Set(chats.nativeSessionIds).size!==2||canonical(chats.contentMarkers)!==canonical([prefix+'skill',prefix+'request',prefix+'reply'])||!chats.nativeSessionIds.every(id=>Object.entries(chats.chatFiles).some(([file,hash])=>file.includes(id)&&file.endsWith('.zstd')&&/^[a-f0-9]{64}$/u.test(hash))))problems.push(label+' retained profile/chat proof differs');
  for(const operation of ['install-skills','update-skills','remove-plugin','uninstall-crosschat-data'])if(!normal(read(directory+label+'-'+operation+'.json')))problems.push(label+' native maintenance process not normal: '+operation);
  attempts.push({label,version:report.version,runId:report.runId,checks:report.checks,source:report.source,terminal:report.terminal,cleanup:report.cleanup,process:report.process,installTimings:[...(install.stderr??'').matchAll(/npm timing npm Completed in (\d+)ms/gu)].map(match=>Number(match[1])),retainedSessionIds:chats.nativeSessionIds,profileSha256:chats.profileSha256,chatFileCount:Object.keys(chats.chatFiles).length});
}
if(new Set(attempts.map(attempt=>attempt.runId)).size!==2)problems.push('Run IDs reused');
const graph=lock=>Object.fromEntries(Object.entries(lock.packages).filter(([key])=>key).map(([key,value])=>[key,{version:value.version,integrity:value.integrity}]));
const first=read('linux-first-inspection/baseline-package-lock.json');const second=read(directory+'baseline-package-lock.json');
const graphSame=canonical(graph(first))===canonical(graph(second));
const archive=fs.readFileSync(new URL('linux-short-onboarding-evidence.tgz',cache));
const result={schema:1,source:'3ebf6ca5d8c54939bb4290c064baed5c647f73ff',environment:read('linux-short-environment.json'),verifiedCompatible:problems.length===0,scope:summary.scope,builds:summary.builds,attempts,disposition,baselineDependencyVersionsAndIntegritySameAsFirstRun:graphSame,archive:{file:'linux-short-onboarding-evidence.tgz',bytes:archive.length,sha256:createHash('sha256').update(archive).digest('hex')},problems,macosExecuted:false,hostedExecuted:false};
fs.writeFileSync(new URL('linux-short-verification.json',cache),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({verifiedCompatible:result.verifiedCompatible,attempts:attempts.map(value=>({label:value.label,version:value.version,checks:value.checks.length,terminal:value.terminal,cleanup:value.cleanup})),baselineGraphSame:graphSame,problems}));
if(problems.length)process.exitCode=1;
