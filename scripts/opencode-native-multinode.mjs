import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve, join } from 'node:path';
import process from 'node:process';
import { createOpenCodeFixture } from '../test/helpers/opencode-live-fixture.mjs';
import { textStream } from '../test/helpers/opencode-mock-model.mjs';
import { validateOpenCodeNativeMultinode } from '../test/helpers/opencode-native-multinode.mjs';

assert.equal(process.env.CROSSCHAT_LIVE, '1', 'CROSSCHAT_LIVE=1 is required for an isolated official OpenCode run');
const binary = process.env.OPENCODE_BIN;
const evidence = resolve(process.env.OPENCODE_C22_EVIDENCE ?? 'opencode-native-multinode-evidence');
assert(binary && isAbsolute(binary), 'OPENCODE_BIN must be an absolute official OpenCode executable path');
await mkdir(evidence, { recursive: true });
const result = { status: 'failed', binary, evidence };
let fixture;
let failure;
try {
  fixture = await createOpenCodeFixture(binary, () => textStream('OPENCODE_C22_PRIMARY_NODE_ACK'));
  result.version = fixture.info.version;
  assert.equal(result.version, '2.1.3', 'This qualification is pinned to official OpenCode 2.1.3');
  const session = await fixture.createSession('C22Primary');
  result.nativeMultinode = await validateOpenCodeNativeMultinode({ binary, fixture, session, evidenceDirectory: evidence });
  result.status = 'passed';
} catch (error) {
  failure = error;
  result.error = error instanceof Error ? error.message : String(error);
  if (error?.nativeMultinodeReport) result.nativeMultinode = error.nativeMultinodeReport;
} finally {
  try { if (fixture) await fixture.close(); result.fixtureRemoved = true; }
  catch (error) {
    result.fixtureRemoved = false;
    result.cleanupError = error instanceof Error ? error.message : String(error);
    result.status = 'failed';
  }
  await writeFile(join(evidence, 'c22-run-report.json'), JSON.stringify(result, null, 2) + '\n');
}
process.stdout.write(JSON.stringify({ status: result.status, checks: result.nativeMultinode?.checks?.length ?? 0,
  cleanup: result.fixtureRemoved, error: result.error }) + '\n');
if (failure) throw failure;
assert.equal(result.status, 'passed', result.cleanupError);
