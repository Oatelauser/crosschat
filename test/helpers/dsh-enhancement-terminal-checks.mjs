// Keyboard-only operator A, independent operator B API, and public resource events.
import assert from 'node:assert/strict';
import {openDshRenameForm} from './dsh-enhancement-terminal-ready.mjs';

export async function runDshTerminalChecks({terminals,fixtures,native,machineIds,stars,operators,target,describe,member,expectTerminals,report,readEvents,pollDsh}) {
 const terminal=terminals[0],pty=terminal.pty,star=stars[0],source=fixtures[0];
 const events=()=>readEvents(terminal.events);
 const waitEvent=(predicate,after=0)=>pollDsh(async()=>(await events()).slice(after).find(predicate),'cross-operator terminal evidence',15000);
 const send=async(keys,expected)=>{const mark=pty.output.length;pty.write(keys);if(expected)await pty.waitForOutput(expected,10000,mark);};
 const exact=entry=>{assert.equal(entry.route.resourceId,'members');assert.equal(entry.route.query.starId,star);const selected=JSON.parse(entry.operationTarget);assert.equal(selected.rowId,entry.targetId);assert.equal(selected.machineId,machineIds[0]);assert.equal(selected.nativeId,native[0].id);assert.equal(selected.providerId,'dsh');assert.equal(selected.endpointType,'host');return entry.targetId;};
 const copy=async()=>{const after=(await events()).length;pty.write('y');return (await waitEvent(e=>e.event==='clipboard',after)).value;};
 const restoreMembership=async()=>{const d=await describe(0,star,1);const r=await operators[1].operate(target(0),{kind:'apply',operation:'adopt',expectedRevision:d.revision});assert.equal(r.result.kind,'applied',JSON.stringify(r.result));return r.result;};
 report.terminalMembershipRestores=[await restoreMembership()];
 const before=await source.snapshot(native[0].id),other=await fixtures[1].snapshot(native[1].id);
 // Keep a stable native-ID filter while the visible name changes in another process.
 await send('/'+native[0].id+'\r',/1\/1/u);
 let outputMark=pty.output.length;
 const firstCopy=await copy();assert(firstCopy.includes('--tool dsh'));assert(firstCopy.includes(star));
 let mark=(await events()).length;await openDshRenameForm({pty,from:outputMark});
 const initial=await waitEvent(e=>e.event==='preview'&&e.action==='rename-session'&&e.result.enabled,mark),rowId=exact(initial);
 const staleName='C22StaleForm'+Date.now();await send(staleName,staleName);
 const externalName='C22Other'+String(Date.now()).slice(-6),description=await describe(0,star,1);
 const externalResult=await operators[1].operate(target(0),{kind:'apply',operation:'rename',name:externalName,expectedRevision:description.revision});report.externalTerminalRename={result:externalResult.result,snapshot:await source.snapshot(native[0].id)};assert.equal(externalResult.result.kind,'applied',JSON.stringify(externalResult.result));
 await pollDsh(()=>member(star,0)?.name===externalName,'other operator authoritative rename');
 // A still holds its form; B must observe its own result without A input or writes.
 await pollDsh(async()=>(await readEvents(terminals[1].events)).some(e=>e.event==='read'&&e.resource==='members'&&JSON.stringify(e.page).includes(externalName)),'second operator observes external rename');
 assert.equal((await source.snapshot(native[0].id)).events.length,before.events.length+1);
 assert(!(await events()).slice(mark).some(e=>e.event==='mutation-start'));
 await source.controller('/bridge',{enabled:false});
 mark=(await events()).length;await send('\t\t\r');
 const disabled=await waitEvent(e=>e.event==='preview'&&e.action==='rename-session'&&!e.result.enabled,mark);assert.equal(exact(disabled),rowId);
 assert.equal(disabled.values.name,staleName);assert(!(await events()).slice(mark).some(e=>e.event==='mutation-start'));
 await source.controller('/bridge',{enabled:true});
 await pollDsh(async()=>(await describe(0)).actions.rename.state==='executable','bridge read-only recovery');
 assert.equal((await source.snapshot(native[0].id)).events.length,before.events.length+1);
 await send('\x1b','已取消操作');
 report.terminalMembershipRestores.push(await restoreMembership());
 await pollDsh(async()=>(await events()).some(e=>e.event==='read'&&e.resource==='members'&&e.page.rows.some(row=>row.id===rowId&&row.cells.name===externalName)),'cancel returns to same native-ID filtered selection');
 outputMark=pty.output.length;
 const recoveredCopy=await copy();assert(recoveredCopy.includes(native[0].id));assert(recoveredCopy.includes('--tool dsh'));assert(recoveredCopy.includes(star));
 mark=(await events()).length;await openDshRenameForm({pty,from:outputMark});
 const reopened=await waitEvent(e=>e.event==='preview'&&e.action==='rename-session'&&e.result.enabled,mark);assert.equal(exact(reopened),rowId);
 const finalName='C22Key'+String(Date.now()).slice(-6);await send(finalName,finalName);await send('\t\t\r');
 const mutation=await waitEvent(e=>e.event==='mutation'&&e.action==='rename-session',mark);assert.equal(exact(mutation),rowId);assert.equal(mutation.values.name,finalName);
 await pollDsh(()=>member(star,0)?.name===finalName,'keyboard rename authoritative result');await expectTerminals([finalName]);
 const finalCopy=await copy();assert(finalCopy.includes(native[0].id));assert(finalCopy.includes('--tool dsh'));assert(finalCopy.includes(star));
 const after=await source.snapshot(native[0].id);assert.equal(after.sameAgent,true);assert.deepEqual(after.events.slice(0,before.events.length),before.events);assert.equal(after.events.length,before.events.length+2);assert(after.events.slice(-2).every(e=>e.type==='session/title'));
 assert.deepEqual((await fixtures[1].snapshot(native[1].id)).events,other.events);
 assert.equal(source.model.requests.length,0);assert.equal(fixtures[1].model.requests.length,0);
 report.renamed=finalName;
 report.crossOperatorTerminal={rowId,nativeId:native[0].id,machineId:machineIds[0],starId:star,firstCopy,recoveredCopy,finalCopy,blockedPreview:disabled,mutation,successfulRenames:2,
  scope:'No automatic submission across another operator rename or bridge recovery; explicit confirmation while unavailable rejects; cancel and reopen retain the exact target within a native-ID-filtered scenario; filter value and scroll state are not independently observed.'};
 return {successfulRenames:2};
}
