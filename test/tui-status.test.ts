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
  it('keeps native unknown distinct from absence and handles native Codex object states', () => {
    const registry = createStatusRegistry();
    expect(registry.format('codex', undefined)).toBe('未提供<—>');
    expect(registry.format('codex', 'unknown')).toBe('未知<unknown>');
    expect(registry.format('codex', { type: 'notLoaded' })).toBe('未加载<notLoaded>');
    expect(registry.format('codex', { type: 'active', activeFlags: ['waitingOnApproval'] })).toBe('等待批准<active>');
    expect(registry.format('codex', { type: 'active', activeFlags: ['waitingOnUserInput'] })).toBe('等待输入<active>');
    expect(registry.format('codex', { type: 'futureNativeState', key: 'must-not-print' })).toBe('未识别<futureNativeState>');
  });
  it('takes an isolated label snapshot and never treats inherited names as registrations', () => {
    const labels = { third: { active: '自定义运行' } };
    const registry = createStatusRegistry(labels);
    labels.third.active = '后来修改';
    expect(registry.format('third', 'active')).toBe('自定义运行<active>');
    expect(registry.format('third', 'constructor')).toBe('未识别<constructor>');
    expect(registry.format('constructor', 'idle')).toBe('未识别<idle>');
    expect(createStatusRegistry().format('third', 'active')).toBe('未识别<active>');
  });
});
