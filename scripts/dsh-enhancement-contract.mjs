import {isDeepStrictEqual} from 'node:util';

export const DSH_ENHANCEMENT_CHECKS=Object.freeze([
 'two-node-identities-and-remote-exact-source-isolation',
 'two-independent-terminal-observers-open-the-same-authoritative-star',
 'explicit-adoption-refreshes-both-operators-and-isolates-the-other-star',
 'permanent-membership-survives-two-temporary-window-claims-and-erase-release',
 'temporary-window-release-is-exact-and-independent-across-stars',
 'native-rename-syncs-both-operators-without-changing-the-other-node',
 'lost-native-write-receipt-is-uncertain-and-readonly-recovery-never-replays',
 'lost-broker-receipt-is-uncertain-and-other-operator-observes-one-write',
 'bridge-loss-and-recovery-stay-local-and-reject-old-confirmations',
 'cross-operator-confirmation-recovery-and-keyboard-selection-stay-exact',
 'exact-removal-does-not-change-other-node-or-native-chat',
]);
export const DSH_ENHANCEMENT_SCOPE=Object.freeze({officialNpmRuntime:true,ordinaryWebSessions:true,scriptedLocalModel:true,
 nativeTty:true,independentLogicalNodes:2,terminalObservers:2,desktop:false,browserUI:false,physicalCrossMachine:false,modelIntelligence:false});
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const empty=value=>Array.isArray(value)&&value.length===0;
const pid=value=>Number.isSafeInteger(value)&&value>0;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const releasedHost=value=>record(value)&&pid(value.pid)&&record(value.cleanup)&&value.cleanup.runtimeStopped===true
 &&value.cleanup.registrationRemoved===true&&value.cleanup.removed===true&&value.cleanup.forced===false
 &&(value.cleanup.errors===undefined||empty(value.cleanup.errors));
const releasedNode=value=>record(value)&&pid(value.pid)&&record(value.exit)&&value.exit.code===0&&value.exit.signal===null
 &&Array.isArray(value.messages)&&value.messages.some(message=>record(message)&&message.event==='stopped'&&message.pid===value.pid&&empty(message.failures));
const terminalState=value=>record(value)&&value.raw===false&&Number.isSafeInteger(value.resize)&&value.resize>=0&&record(value.listeners)
 &&Object.values(value.listeners).every(count=>Number.isSafeInteger(count)&&count>=0);
const releasedTerminal=value=>record(value)&&[0,1].includes(value.index)&&record(value.exit)&&value.exit.event==='exit'&&value.exit.code===0
 &&terminalState(value.exit.before)&&terminalState(value.exit.after)&&isDeepStrictEqual(value.exit.before,value.exit.after);

/** Valid means attributable evidence, including a failed run; callers must also inspect status. */
export function validateDshEnhancementReport(value,binding){
 const fail=reason=>({valid:false,reason});
 if(!record(value)||!record(binding))return fail('Report and binding must be records');
 if(value.schema!==1||value.tool!=='dsh-enhancement')return fail('Wrong report schema or tool');
 if(!uuid.test(binding.runId??'')||!/^[0-9a-f]{40}$/u.test(binding.sourceHead??'')||binding.version!=='0.2.1-rc.5'
  ||!(((binding.platform==='win32'||binding.platform==='linux')&&binding.arch==='x64')||(binding.platform==='darwin'&&['x64','arm64'].includes(binding.arch))))return fail('Invalid run binding or unplanned target');
 if(['runId','sourceHead','platform','arch','version'].some(field=>value[field]!==binding[field])||value.node!=='v22.23.4')return fail('Report does not match the bound run');
 if(!isDeepStrictEqual(value.scope,DSH_ENHANCEMENT_SCOPE))return fail('Scope does not match the qualified suite');
 if(!['passed','failed'].includes(value.status)||!Array.isArray(value.checks)||value.checks.length>DSH_ENHANCEMENT_CHECKS.length
  ||!value.checks.every((check,index)=>record(check)&&check.name===DSH_ENHANCEMENT_CHECKS[index]&&check.status==='passed'
   &&(check.elapsedMs===undefined||(Number.isFinite(check.elapsedMs)&&check.elapsedMs>=0))))return fail('Invalid ordered checks or status');
 if(value.status==='passed'&&(value.checks.length!==DSH_ENHANCEMENT_CHECKS.length||value.error!==undefined))return fail('Passed report is incomplete or has an error');
 if(value.status==='failed'&&(!record(value.error)||typeof value.error.message!=='string'||!value.error.message))return fail('Failed report lacks its failure');
 if(value.unsafe!==false||value.outerRemoved!==true||!empty(value.cleanupFailures))return fail('Owned outer cleanup is unconfirmed');
 for(const [field,validate]of [['hosts',releasedHost],['nodes',releasedNode],['terminals',releasedTerminal]]){
  const resources=value[field];
  if(!Array.isArray(resources)||resources.length>2||(value.status==='passed'&&resources.length!==2)||!resources.every(validate))return fail('Invalid '+field+' release evidence');
  const ids=resources.map(resource=>field==='terminals'?resource.index:resource.pid);if(new Set(ids).size!==ids.length)return fail('Duplicate '+field+' identity');
 }
 if(binding.platform!=='win32'&&!value.terminals.every(terminal=>record(terminal.transportCleanup)
  &&terminal.transportCleanup.forced===false&&terminal.transportCleanup.groupReleased===true))return fail('POSIX terminal process-group release is unconfirmed');
 if(new Set([...value.hosts,...value.nodes].map(resource=>resource.pid)).size!==value.hosts.length+value.nodes.length)return fail('Host and node process identities overlap');
 const native=value.nativeReceiptFault,broker=value.brokerReceiptFault;
 if(value.status==='passed'||native!==undefined){
  if(!record(native)||native.titlePosts!==1||native.acceptedWrites!==1||native.droppedReceipts!==1||native.registrationRestored!==true||native.proxyClosed!==true)return fail('Native receipt fault or release is unconfirmed');
 }
 if(value.status==='passed'||broker!==undefined){
  if(!record(broker)||broker.requests!==1||broker.acceptedReceipts!==1||broker.droppedReceipts!==1||broker.configRestored!==true||broker.proxyClosed!==true)return fail('Broker receipt fault or release is unconfirmed');
 }
 return {valid:true};
}
