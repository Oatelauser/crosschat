import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const directory='docs/development/evidence/c12-posix-onboarding-20261105';
const original=JSON.parse(fs.readFileSync(path.join(directory,'pty-validation.json'),'utf8'));
const checkpoint='d408b0f'; const note='pty-development.md';const snapshot='pty-stage-development.md';
const raw=spawnSync('git',['show',checkpoint+':'+directory+'/'+note],{windowsHide:true,maxBuffer:1024*1024,timeout:10000});
if(raw.status!==0)throw new Error('Original PTY checkpoint note is unavailable');
const expected=original.artifacts.find(value=>value.file===note);
if(!expected||raw.stdout.length!==expected.bytes||createHash('sha256').update(raw.stdout).digest('hex')!==expected.sha256)throw new Error('Checkpoint note does not match its original index');
fs.writeFileSync(path.join(directory,snapshot),raw.stdout,{flag:'wx'});
const resolved={...original,sourceCheckpoint:checkpoint,originalIndex:'pty-validation.json',resolution:'The development note evolved after the PTY checkpoint. Its original indexed bytes are preserved under pty-stage-development.md; all other artifacts are unchanged.',artifacts:original.artifacts.map(value=>value.file===note?{...value,file:snapshot}:value)};
for(const entry of resolved.artifacts){const bytes=fs.readFileSync(path.join(directory,entry.file));if(bytes.length!==entry.bytes||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error('Resolved artifact mismatch: '+entry.file);}
fs.writeFileSync(path.join(directory,'pty-validation-resolved.json'),JSON.stringify(resolved,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({checkpoint,artifactsVerified:resolved.artifacts.length,originalIndexPreserved:true,developmentNoteSnapshotted:true}));
