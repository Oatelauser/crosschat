import { describe, expect, it } from 'vitest';
import type { TuiOverlay } from '../src/tui/model.js';
import { displayWidth } from '../src/tui/ui/text.js';

function overlay(values: Partial<TuiOverlay> = {}): TuiOverlay {
  return {
    actionId: 'test-action', ownerResourceId: 'sessions', contextId: 'local', targetId: 'opaque/full/target', title: '测试确认',
    fields: [], focusIndex: 0, phase: 'confirming', impact: [], confirmationDefault: 'cancel', ...values,
  };
}

describe('complete form confirmation content', () => {
  it('keeps the complete owner, context, target, impacts and error reachable as bounded visual lines', async () => {
    const { formContentLines } = await import('../src/tui/app/form.js');
    const contextId = 'ssh:完整连接👩‍💻'.repeat(5);
    const targetId = 'opaque/full/完整目标/é/'.repeat(6);
    const impact = '将影响完整目录/very/long/path/与既有连接👩‍💻。'.repeat(9);
    const error = '拒绝执行：请核对当前目标与授权，保留表单后再继续。'.repeat(7);
    const lines = formContentLines(overlay({ contextId, targetId, impact: [impact, '仅修改当前对象'], error }), 24);
    expect(lines.every((line) => displayWidth(line.text) <= 24)).toBe(true);
    const context = lines.filter((line) => line.kind === 'context').map((line) => line.text).join('');
    expect(context).toContain('sessions');
    expect(context).toContain(contextId);
    expect(context).toContain(targetId);
    expect(lines.filter((line) => line.kind === 'impact').map((line) => line.text).join('')).toContain(impact);
    expect(lines.filter((line) => line.kind === 'error').map((line) => line.text).join('')).toBe(error);
    expect(lines.filter((line) => line.kind === 'context').length).toBeGreaterThan(1);
    expect(lines.filter((line) => line.kind === 'impact').length).toBeGreaterThan(9);
  });

  it('keeps fields on one indexed line, masks secrets and sanitizes controls without changing the editable values', async () => {
    const { formContentLines } = await import('../src/tui/app/form.js');
    const input = overlay({
      targetId: 'safe\u001b[2J-target',
      fields: [
        { id: 'name', label: '长显示名', value: '可横向编辑👩‍💻'.repeat(8), cursor: 3 },
        { id: 'secret', label: '秘密', value: 'fixture-secret-value', secret: true, cursor: 0 },
      ],
      impact: ['核对\u001b]0;spoofed\u0007完整影响'], error: '未执行\u001b[31m操作\u001b[0m',
    });
    const lines = formContentLines(input, 20);
    expect(lines.filter((line) => line.kind === 'field').map((line) => line.fieldIndex)).toEqual([0, 1]);
    expect(lines.every((line) => displayWidth(line.text) <= 20)).toBe(true);
    const rendered = lines.map((line) => line.text).join('');
    expect(rendered).toContain('safe-target');
    expect(rendered).toContain('核对完整影响');
    expect(rendered).toContain('未执行操作');
    expect(rendered).not.toContain('\u001b');
    expect(rendered).not.toMatch(/spoofed|fixture-secret-value/);
    expect(lines.find((line) => line.kind === 'field' && line.fieldIndex === 1)?.text).toContain('•');
    expect(input.fields[0].value).toBe('可横向编辑👩‍💻'.repeat(8));
    expect(input.fields[1].value).toBe('fixture-secret-value');
  });
});
