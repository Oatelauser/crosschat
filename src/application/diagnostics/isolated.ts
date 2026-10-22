import process from 'node:process';
import { collectDoctorDiagnostics } from './checks.js';
import { defaultDoctorDeps } from './deps.js';

if (process.send === undefined) throw new Error('Diagnostic isolation requires a parent IPC channel');
// Keep the process tree owned until the querying parent disposes it.
process.on('disconnect', () => process.exit(0));
process.send(collectDoctorDiagnostics(defaultDoctorDeps({ home: process.env.CROSSCHAT_DIAGNOSTIC_HOME, env: process.env })));
