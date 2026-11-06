import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { isAbsolute, join, posix } from 'node:path';

export function buildC22NodeDirectory(root,index) {
 assert(typeof root==='string'&&isAbsolute(root),'Expected an absolute C22 run root');
 assert(index===0||index===1,'Expected one of the two C22 logical nodes');
 return posix.isAbsolute(root)?posix.join(root,'n'+index):join(root,'n'+index);
}

/** Fixture namespace only: retain 96 digest bits across the run/node/star tuple. */
export function buildC22AttachLabel(owner,machineId,starId) {
 for(const value of [owner,machineId,starId])assert(typeof value==='string'&&value.length>0,'Missing C22 namespace component');
 return 'c22-'+createHash('sha256').update(JSON.stringify([owner,machineId,starId])).digest('hex').slice(0,24);
}

/** Pure preflight for the same production endpoint layout, without changing its naming. */
export function buildC22AttachPath(platform,baseDir,label) {
 assert(typeof label==='string'&&/^[a-z0-9-]+$/u.test(label),'Invalid C22 attach label');
 assert(typeof baseDir==='string'&&baseDir.length>0,'Missing C22 attach directory');
 const path=platform==='win32'?'\\\\.\\pipe\\crosschat-attach-'+label:posix.join(baseDir,'attach-'+label+'.sock');
 assertC22AttachPath(path,platform);return path;
}

export function assertC22AttachPath(path,platform) {
 assert(['win32','linux','darwin'].includes(platform),'Unplanned C22 platform');
 assert(typeof path==='string'&&!path.includes('\0'),'Invalid C22 attach endpoint');
 if(platform==='win32')assert(path.startsWith('\\\\.\\pipe\\crosschat-attach-'),'Expected a Windows named pipe');
 else {assert(posix.isAbsolute(path),'Expected an absolute UNIX socket path');assert(Buffer.byteLength(path)<=103,'C22 UNIX socket path exceeds the shared 103-byte budget');}
}
