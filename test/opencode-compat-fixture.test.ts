import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { assessStartupEvidence, classifyCompatibility, parseArtifactManifest } from '../scripts/opencode-compat-report.mjs';
import { createMockModel, textStream, toolStream } from './helpers/opencode-mock-model.mjs';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });

describe('OpenCode compatibility evidence', () => {
  it('reports a regression only when a good baseline and repeat candidate failure agree', () => {
    const ok = { status: 'passed', stage: 'done', version: '2.1.3' };
    const failure = { status: 'failed', stage: 'contract', version: '2.1.4', check: 'native-queue', category: 'compatibility' };
    expect(classifyCompatibility(ok, failure, failure)).toMatchObject({ kind: 'regression', notify: true });
    expect(classifyCompatibility(ok, failure, ok)).toMatchObject({ kind: 'flaky', notify: false });
    expect(classifyCompatibility(failure, failure, failure)).toMatchObject({ kind: 'baseline-failed', notify: false });
    expect(classifyCompatibility(ok, { ...failure, category: 'infrastructure' }, failure)).toMatchObject({ kind: 'infrastructure', notify: false });
  });

  it('keeps two different candidate failures inconclusive and requires identical candidate builds', () => {
    const ok = { status: 'passed', stage: 'done', version: '2.1.3' };
    const failure = { status: 'failed', stage: 'contract', version: '2.1.4', check: 'native-queue', category: 'compatibility' };
    expect(classifyCompatibility(ok, failure, { ...failure, check: 'reply' })).toMatchObject({ kind: 'inconclusive', notify: false });
    expect(classifyCompatibility(ok, failure, { ...failure, version: '2.1.5' })).toMatchObject({ kind: 'inconclusive', notify: false });
  });

  it('pins the official candidate URL and checksum from one validated manifest', () => {
    const manifest = { version: '2.1.4', name: 'cli', distribution: 'opencode', metadata: { files: {
      'opencode-linux-x64.tar.gz': { url: 'https://opencode.ai/files/bin/2.1.4/opencode-linux-x64.tar.gz', sha256: 'a'.repeat(64), size: 123 },
    } } };
    expect(parseArtifactManifest(manifest, 'linux', 'x64')).toMatchObject({ version: '2.1.4', sha256: 'a'.repeat(64), size: 123 });
    expect(() => parseArtifactManifest({ ...manifest, version: '1.19.4' }, 'linux', 'x64')).toThrow();
    const changed = structuredClone(manifest);
    changed.metadata.files['opencode-linux-x64.tar.gz'].url = 'https://unrelated.example/tool.tar.gz';
    expect(() => parseArtifactManifest(changed, 'linux', 'x64')).toThrow();
  });

  it('distinguishes service protocol changes from process or transient readiness failures', () => {
    const evidence = { processAlive: true, expectedPid: 123, registrationExists: true, registration: { url: 'http://127.0.0.1:12345', password: 'fixture-only', pid: 123 }, responseStatus: 200, responseBody: { version: '2.1.3', pid: 123 } };
    expect(assessStartupEvidence(evidence)).toMatchObject({ ready: true });
    expect(assessStartupEvidence({ ...evidence, responseStatus: 401 })).toMatchObject({ category: 'compatibility', check: 'service-authentication' });
    expect(assessStartupEvidence({ ...evidence, responseStatus: 404 })).toMatchObject({ category: 'compatibility', check: 'service-info-route' });
    expect(assessStartupEvidence({ ...evidence, responseBody: {} })).toMatchObject({ category: 'compatibility', check: 'service-info-schema' });
    expect(assessStartupEvidence({ ...evidence, registration: {} })).toMatchObject({ category: 'compatibility', check: 'service-registration-schema' });
    expect(assessStartupEvidence({ ...evidence, processAlive: false })).toMatchObject({ category: 'infrastructure', check: 'service-process' });
    expect(assessStartupEvidence({ ...evidence, responseStatus: 503 })).toMatchObject({ category: 'infrastructure', retry: true });
  });

  it('surfaces a newly published major as an unsupported release requiring a decision', () => {
    let error: unknown;
    try { parseArtifactManifest({ version: '3.0.0', name: 'cli', distribution: 'opencode', metadata: { files: {} } }, 'linux', 'x64'); }
    catch (caught) { error = caught; }
    expect(error).toMatchObject({ category: 'unsupported', version: '3.0.0' });
  });
});

describe('model-only HTTP fixture', () => {
  it('streams a scripted model response and records the actual tool request body', async () => {
    const model = await createMockModel(() => textStream('fixture accepted'));
    cleanups.push(model.close);
    const body = { model: 'fixture', messages: [{ role: 'user', content: 'hello' }], stream: true };
    const response = await fetch(`${model.url}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(await response.text()).toContain('fixture accepted');
    expect(model.requests).toEqual([body]);
    expect((await fetch(`${model.url}/unexpected`)).status).toBe(404);
  });

  it('supports a controlled step boundary without a real model or credentials', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const model = await createMockModel(async () => { await gate; return toolStream('bash', { command: 'node --version', description: 'fixture tool' }); });
    cleanups.push(model.close);
    const response = fetch(`${model.url}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    await model.waitForRequests(1);
    release();
    const stream = await (await response).text();
    expect(stream).toContain('tool_calls');
    expect(stream).toContain('node --version');
    expect(stream).toContain('[DONE]');
  });
});

describe('OpenCode compatibility workflow trust boundary', () => {
  it('keeps probes read-only and separates CLI/Desktop evidence from issue reporting', async () => {
    const workflow = await readFile(new URL('../.github/workflows/opencode-compat.yml', import.meta.url), 'utf8');
    const probe = workflow.split('\n  probe:')[1]?.split('\n  desktop-probe:')[0] ?? '';
    const desktop = workflow.split('\n  desktop-probe:')[1]?.split('\n  report:')[0] ?? '';
    const report = workflow.split('\n  report:')[1] ?? '';

    expect(probe).not.toBe('');
    expect(desktop).not.toBe('');
    expect(report).not.toBe('');
    expect(workflow).toMatch(/^ {2}schedule:/m);
    expect(workflow).toMatch(/^ {2}workflow_dispatch:/m);
    expect(workflow).not.toMatch(/pull_request|workflow_run|\bsecrets\./);
    expect(workflow).toMatch(/^permissions:\r?\n {2}contents: read/m);

    expect(probe).toMatch(/matrix:\r?\n {8}os: \[ubuntu-latest, windows-latest\]/);
    expect(probe).toMatch(/runs-on: \$\{\{ matrix\.os \}\}/);
    expect(probe).toContain('node scripts/opencode-compat-ci.mjs');
    expect(probe).toMatch(/persist-credentials: false/);
    expect(probe).not.toMatch(/issues: write|contents: write|GITHUB_TOKEN|GH_TOKEN/);
    expect(probe).toContain('name: opencode-compat-${{ matrix.os }}');
    expect(probe).toContain('path: opencode-compat-evidence/');

    expect(desktop).toMatch(/runs-on: windows-latest/);
    expect(desktop).toContain('node scripts/opencode-desktop-compat-ci.mjs');
    expect(desktop).toMatch(/persist-credentials: false/);
    expect(desktop).not.toMatch(/issues: write|contents: write|GITHUB_TOKEN|GH_TOKEN/);
    expect(desktop).toContain('name: opencode-compat-desktop-windows-latest');
    expect(desktop).toContain('path: opencode-desktop-compat-evidence/');
    expect(desktop).not.toContain('path: opencode-compat-evidence/');

    expect(report).toMatch(/needs: \[probe, desktop-probe\]/);
    expect(report).toMatch(/issues: write/);
    expect(report).toContain('actions/download-artifact@v4');
    expect(report).toContain('path: evidence');
    expect(report).not.toMatch(/actions\/checkout|npm (ci|run)|node scripts\/opencode-|CROSSCHAT_LIVE|OPENCODE_BIN/);
  });
});
