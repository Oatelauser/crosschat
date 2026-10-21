import { parentPort } from 'node:worker_threads';
import { collectDoctorDiagnostics } from './checks.js';
import { defaultDoctorDeps } from './deps.js';

if (parentPort === null) throw new Error('Diagnostic worker requires a parent port');
parentPort.postMessage(collectDoctorDiagnostics(defaultDoctorDeps()));
