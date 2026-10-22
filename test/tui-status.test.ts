import { describe, expect, it } from 'vitest';
import { createStatusRegistry } from '../src/tui/resources/status.js';

describe('extensible native status labels', () => {
  it('keeps known, unknown and missing native values distinct', () => {
    const registry = createStatusRegistry();
    expect(registry.format('codex', 'idle')).toBe('空闲<idle>');
    expect(registry.format('codex', 'not_loaded')).toBe('未加载<not_loaded>');
    expect(registry.format('future-provider', 'new-value')).toBe('未识别<new-value>');
    expect(registry.format('future-provider', null)).toBe('未提供<—>');
  });
  it('allows another Provider to register native labels without changing a page', () => {
    const registry = createStatusRegistry({ 'future-provider': { pondering: '思考中' } });
    expect(registry.format('future-provider', { type: 'pondering' })).toBe('思考中<pondering>');
    expect(registry.format('codex', 'pondering')).toBe('未识别<pondering>');
  });
});
