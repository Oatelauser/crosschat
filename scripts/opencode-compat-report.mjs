import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

/** Attribute deterministic wire changes separately from a tool which could not boot. */
export function assessStartupEvidence(evidence) {
  const failure = (category, check, retry = false) => ({ ready: false, category, check, retry });
  if (!evidence.processAlive) return failure('infrastructure', 'service-process');
  if (!evidence.registrationExists) return failure('infrastructure', 'service-registration-unavailable', true);
  const registration = evidence.registration;
  if (!record(registration) || typeof registration.url !== 'string' || typeof registration.password !== 'string'
    || registration.pid !== evidence.expectedPid) return failure('compatibility', 'service-registration-schema');
  const status = evidence.responseStatus;
  if (status === 401 || status === 403) return failure('compatibility', 'service-authentication');
  if (status === 404 || status === 405) return failure('compatibility', 'service-info-route');
  if (status === undefined || status === 429 || status >= 500) return failure('infrastructure', 'service-readiness', true);
  if (status < 200 || status >= 300) return failure('compatibility', 'service-info-response');
  if (!record(evidence.responseBody) || typeof evidence.responseBody.version !== 'string'
    || evidence.responseBody.pid !== evidence.expectedPid) return failure('compatibility', 'service-info-schema');
  return { ready: true };
}

/** A healthy reference build is required before blaming a newly published tool. */
export function classifyCompatibility(baseline, candidate, retry) {
  if (baseline?.status !== 'passed') return { kind: 'baseline-failed', notify: false };
  if ([candidate, retry].some((item) => item?.category === 'infrastructure')) return { kind: 'infrastructure', notify: false };
  if (candidate?.status === 'passed') return { kind: 'compatible', notify: false };
  if (retry?.status === 'passed') return { kind: 'flaky', notify: false };
  if (candidate?.status !== 'failed' || retry?.status !== 'failed' || !candidate.version
    || candidate.version !== retry.version || candidate.check !== retry.check
    || candidate.stage !== retry.stage || candidate.category !== 'compatibility'
    || retry.category !== 'compatibility') return { kind: 'inconclusive', notify: false };
  return { kind: 'regression', notify: true };
}

export function assessNativeEnhancement(report, exitCode, expectedVersion) {
  const tests = report?.tests;
  const passed = exitCode === 0
    && report?.version === expectedVersion
    && report?.fixtureRemoved === true
    && report?.nativeMultinode?.status === 'passed'
    && report?.nativeMultinode?.cleanup?.complete === true
    && Array.isArray(tests)
    && tests.length > 0
    && tests.every((test) => test?.passed === true)
    && report?.failure === undefined
    && report?.cleanupErrors === undefined;
  return { status: passed ? 'passed' : 'failed', version: report?.version ?? null, checks: tests?.length ?? 0 };
}

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

/** Resolve once, then download that immutable artifact; never follow a second "latest" lookup. */
export function parseArtifactManifest(input, platform, arch) {
  if (!record(input) || input.name !== 'cli' || input.distribution !== 'opencode'
    || typeof input.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(input.version)
    || !record(input.metadata) || !record(input.metadata.files)) throw new Error('Invalid OpenCode V2 release manifest');
  if (Number(input.version.split('.')[0]) > 2) throw Object.assign(new Error(`OpenCode ${input.version} is a new unsupported major; the baseline remains unchanged`), { category: 'unsupported', version: input.version });
  if (!input.version.startsWith('2.')) throw new Error('Official update service did not return OpenCode V2');
  if (!['linux', 'win32'].includes(platform) || arch !== 'x64') throw new Error('Only Linux/Windows x64 compatibility probes are configured');
  const filename = `opencode-${platform === 'win32' ? 'windows' : platform}-${arch}.${platform === 'win32' ? 'zip' : 'tar.gz'}`;
  const file = input.metadata.files[filename];
  const expected = `https://opencode.ai/files/bin/${input.version}/${filename}`;
  if (!record(file) || file.url !== expected || typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(file.sha256)
    || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 512 * 1024 * 1024) throw new Error('Invalid official OpenCode artifact URL, size or checksum');
  return { version: input.version, filename, url: file.url, sha256: file.sha256, size: file.size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [baselineFile, candidateFile, retryFile] = process.argv.slice(2);
  if (!baselineFile || !candidateFile) throw new Error('usage: node scripts/opencode-compat-report.mjs baseline.json candidate.json [retry.json]');
  const read = async (file) => file ? JSON.parse(await readFile(file, 'utf8')) : undefined;
  const [baseline, candidate, retry] = await Promise.all([read(baselineFile), read(candidateFile), read(retryFile)]);
  process.stdout.write(`${JSON.stringify({ ...classifyCompatibility(baseline, candidate, retry), baseline, candidate, retry }, null, 2)}\n`);
}
