// One independent writer whose shard rename blocks inside the critical section
// until the parent creates the release file (a runtime CJS preload installs the
// hook before dist loads). Proves the real write path holds the shared lock.
import process from 'node:process';
import { handleForRef } from '../../dist/conversations.js';

const [file, refJson] = process.argv.slice(2);

const handle = await handleForRef(file, JSON.parse(refJson));
process.stdout.write(`${JSON.stringify({ handle })}\n`);
