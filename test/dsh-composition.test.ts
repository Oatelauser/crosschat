import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalDiscoveryService } from '../src/application/discovery/local.js';
import type { SessionReader } from '../src/application/sessions/model.js';

const mocks = vi.hoisted(() => ({ reader: vi.fn() }));
vi.mock('../src/application/sessions/dsh-reader.js', () => ({ createDshSessionReader: mocks.reader }));
afterEach(() => vi.resetAllMocks());
const capabilities = { discovery: true, delivery: true, launch: false, diagnostics: false };
function unavailable(kind: string) {
  return { providerId: 'dsh', capabilities, list: async () => ({ items: [], nextCursor: null, completeness: 'unavailable', observedAt: 1,
    errors: [{ source: { contextId: 'local', providerId: 'dsh' }, kind, message: 'isolated source diagnostic' }] }),
  get: async () => ({ item: null, completeness: 'unavailable', observedAt: 1,
    errors: [{ source: { contextId: 'local', providerId: 'dsh' }, kind, message: 'isolated source diagnostic' }] }) };
}
describe('Harness default discovery composition', () => {
  it('registers the provider without querying it, bound to explicit isolated home', () => {
    const fake: SessionReader = { providerId: 'dsh', capabilities, list: vi.fn(), get: vi.fn() };
    mocks.reader.mockReturnValue(fake);
    const home = join('fixture', 'home'); createLocalDiscoveryService({ home });
    expect(mocks.reader).toHaveBeenCalledWith(expect.objectContaining({ home }));
    expect(fake.list).not.toHaveBeenCalled(); expect(fake.get).not.toHaveBeenCalled();
  });
  it('keeps an absent optional bridge from blocking complete legacy discovery or exact adoption', async () => {
    mocks.reader.mockReturnValue(unavailable('missing'));
    const service = createLocalDiscoveryService({ home: join('fixture', 'home') });
    const listed = await service.execute({ op: 'list', filter: { providerIds: ['dsh'] } });
    expect(listed.op === 'list' && listed.page).toMatchObject({ items: [], completeness: 'complete', errors: [] });
    const detail = await service.execute({ op: 'detail', providerId: 'dsh', nativeId: 'not-present' });
    expect(detail.op === 'detail' && detail.detail).toMatchObject({ item: null, completeness: 'complete', errors: [] });
  });
  it.each(['unavailable', 'malformed', 'unreadable'])('retains configured %s source failures', async (kind) => {
    mocks.reader.mockReturnValue(unavailable(kind));
    const listed = await createLocalDiscoveryService({ home: join('fixture', 'home') }).execute({ op: 'list', filter: { providerIds: ['dsh'] } });
    expect(listed.op === 'list' && listed.page).toMatchObject({ completeness: 'unavailable', errors: [{ kind }] });
  });
});
