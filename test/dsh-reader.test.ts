import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDshSessionReader } from '../src/application/sessions/dsh-reader.js';
import { MultichatError } from '../src/errors.js';

const native = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn() }));
vi.mock('../src/dsh/client.js', () => ({ listDshThreadPage: native.list, getDshThread: native.get }));
afterEach(() => vi.resetAllMocks());
const thread = { id: 'native_full_ID', name: null, cwd: '/project', rawStatus: { type: 'running' }, attributes: { instanceId: 'owned-instance', runtimeVersion: '0.2.1-rc.2' } };
const request = { contextId: 'fixture-context', limit: 2, signal: new AbortController().signal };

describe('Harness session metadata adapter', () => {
  it('preserves anonymous native IDs, current cwd, state and verified delivery capabilities', async () => {
    native.list.mockResolvedValue({ data: [thread], nextCursor: null, completeness: 'complete' });
    const reader = createDshSessionReader({ home: '/isolated', now: () => 123 });
    const page = await reader.list(request);
    expect(page).toMatchObject({ completeness: 'complete', observedAt: 123, errors: [], nextCursor: null,
      items: [{ ref: { contextId: 'fixture-context', providerId: 'dsh', nativeId: thread.id }, name: null, rawStatus: thread.rawStatus,
        attributes: { cwd: '/project', instanceId: 'owned-instance' }, capabilities: { discovery: true, delivery: true, deliveryModes: ['queue', 'steer'], launch: false } }] });
    expect(native.list).toHaveBeenCalledWith(expect.objectContaining({ home: '/isolated', limit: 2, signal: request.signal }));
    expect(native.get).not.toHaveBeenCalled();
  });

  it('preserves pagination and incomplete source evidence instead of marking the first page complete', async () => {
    native.list.mockResolvedValue({ data: [thread], nextCursor: 'owned-cursor', completeness: 'partial' });
    const page = await createDshSessionReader().list({ ...request, cursor: 'previous' });
    expect(page).toMatchObject({ completeness: 'partial', nextCursor: 'owned-cursor' });
    expect(native.list).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'previous' }));
  });

  it('keeps exact detail absence separate from process references and source failure', async () => {
    native.get.mockResolvedValue(null);
    const reader = createDshSessionReader({ now: () => 123 });
    expect(await reader.get({ contextId: 'local', nativeId: 'missing' })).toMatchObject({ item: null, completeness: 'complete', errors: [] });
    native.get.mockClear();
    expect(await reader.get({ contextId: 'local', nativeId: '123', referenceKind: 'process' })).toMatchObject({ item: null, completeness: 'complete' });
    expect(native.get).not.toHaveBeenCalled();
  });

  it.each([
    ['DSH_NOT_CONFIGURED', 'missing'], ['DSH_REGISTRATION_MALFORMED', 'malformed'],
    ['DSH_REGISTRATION_UNREADABLE', 'unreadable'], ['DSH_UNSUPPORTED_VERSION', 'unsupported'],
    ['DSH_INVALID_CURSOR', 'invalid-cursor'], ['DSH_UNAVAILABLE', 'unavailable'],
  ])('preserves %s as an explicit source error', async (code, kind) => {
    native.list.mockRejectedValue(new MultichatError(code, 'isolated source diagnostic'));
    const page = await createDshSessionReader().list(request);
    expect(page).toMatchObject({ items: [], completeness: 'unavailable', errors: [{ source: { contextId: 'fixture-context', providerId: 'dsh' }, kind, message: 'isolated source diagnostic' }] });
  });

  it('does not query on an already cancelled read', async () => {
    const controller = new AbortController(); controller.abort();
    const reader = createDshSessionReader();
    expect(await reader.list({ ...request, signal: controller.signal })).toMatchObject({ completeness: 'cancelled' });
    expect(await reader.get({ contextId: 'local', nativeId: 'native', signal: controller.signal })).toMatchObject({ item: null, completeness: 'cancelled' });
    expect(native.list).not.toHaveBeenCalled(); expect(native.get).not.toHaveBeenCalled();
  });
});
