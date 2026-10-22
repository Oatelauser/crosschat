import { useEffect, useSyncExternalStore } from 'react';
import { Box, Text, useInput, usePaste, useWindowSize } from 'ink';
import type { Key } from 'ink';
import type { createTuiController } from '../app/controller.js';
import { detailLines } from '../app/detail.js';
import type { ResourceRegistry } from '../resources/registry.js';
import type { TuiKey, TuiOverlay, TuiResource, TuiSnapshot } from '../model.js';
import { clipText, displayWidth, editorViewport, sanitizeTerminalText } from './text.js';
import { formatTable } from './table.js';

type Controller = ReturnType<typeof createTuiController>;
interface Line { text: string; selected?: boolean; tone?: 'cyan' | 'yellow' | 'red' | 'gray' }
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function editingLine(text: string, cursor: number, width: number): string {
  const view = editorViewport({ text, cursor }, Math.max(0, width - 1));
  let cells = 0;
  let before = '';
  let after = '';
  for (const { segment } of segmenter.segment(view.text)) {
    if (cells < view.cursor) before += segment;
    else after += segment;
    cells += displayWidth(segment);
  }
  return clipText(`${before}▏${after}`, width);
}

function formLines(overlay: TuiOverlay, width: number, height: number): Line[] {
  const lines: Line[] = [{ text: `${overlay.title} · ${overlay.phase === 'submitting' ? '提交中' : overlay.phase === 'confirming' ? '确认影响' : '填写'}`, tone: 'cyan' },
    { text: `资源 ${overlay.ownerResourceId} · 连接 ${overlay.contextId ?? '本机'} · 目标 ${overlay.targetId ?? '新增'}`, tone: 'gray' }];
  for (const [index, field] of overlay.fields.entries()) {
    const prefix = `${field.label}: `;
    const focused = overlay.focusIndex === index;
    const value = field.secret ? '•'.repeat(Math.min(24, Array.from(segmenter.segment(field.value)).length)) : field.value;
    const cursor = field.secret ? value.length : field.cursor ?? Array.from(segmenter.segment(value)).length;
    lines.push({ text: prefix + (focused && overlay.phase === 'editing' ? editingLine(value, cursor, Math.max(0, width - displayWidth(prefix))) : sanitizeTerminalText(value)), selected: focused });
  }
  for (const impact of overlay.impact) lines.push({ text: `影响：${impact}`, tone: 'yellow' });
  if (overlay.error) lines.push({ text: overlay.error, tone: 'red' });
  lines.push({ text: overlay.phase === 'submitting' ? 'Esc 停止等待；已发请求结果须核实' : `${overlay.focusIndex === overlay.fields.length ? '›' : ' '} [取消]   ${overlay.focusIndex === overlay.fields.length + 1 ? '›' : ' '} [${overlay.phase === 'confirming' ? '确认提交' : '检查并继续'}]`, tone: 'cyan' });
  if (lines.length <= height) return lines;
  // Keep the title and controls visible while the field window follows focus.
  const available = Math.max(0, height - 2);
  const focusLine = overlay.focusIndex < overlay.fields.length ? overlay.focusIndex + 2 : lines.length - 2;
  const start = Math.max(1, Math.min(focusLine - Math.floor(available / 2), lines.length - 1 - available));
  return [lines[0], ...lines.slice(start, start + available), lines.at(-1)!].slice(0, height);
}

function bodyLines(snapshot: TuiSnapshot, resource: TuiResource, width: number, height: number): Line[] {
  if (snapshot.help) {
    return [{ text: snapshot.help.title, tone: 'cyan' }, ...snapshot.help.entries.slice(snapshot.help.scrollOffset, snapshot.help.scrollOffset + height - 1).map((entry) => ({
      text: `${entry.shortcut}  ${entry.label}${entry.enabled ? '' : ` · 不可用：${entry.reason ?? '暂不支持'}`}${entry.nextStep ? `；${entry.nextStep}` : ''}`,
      tone: entry.enabled ? undefined : 'gray' as const,
    }))];
  }
  if (snapshot.detail && snapshot.mode !== 'form') {
    const detail = snapshot.detail;
    return [{ text: `${detail.title} · 只读详情${detail.query ? ` /${detail.query}` : ''}`, tone: 'cyan' },
      ...detailLines(detail.fields, Math.max(1, width - 2)).slice(detail.scrollOffset, detail.scrollOffset + height - 1).map((line) => ({
        text: `${line.fieldIndex === detail.selectedIndex ? '› ' : '  '}${line.text}`, selected: line.fieldIndex === detail.selectedIndex,
      }))];
  }
  const table = formatTable({ columns: resource.columns, rows: snapshot.rows, width: Math.max(0, width - 2) });
  const list: Line[] = [{ text: `  ${table.header}`, tone: 'cyan' }];
  if (table.rows.length) {
    for (const row of table.rows.slice(snapshot.scrollOffset, snapshot.scrollOffset + height - 1)) {
      list.push({ text: `${row.id === snapshot.selectedId ? '› ' : '  '}${row.text}`, selected: row.id === snapshot.selectedId });
    }
  } else list.push({ text: snapshot.loading ? '正在读取… Ctrl+C 取消' : snapshot.completeness === 'unavailable' ? '资源尚未启用 · :ctx 返回连接' : snapshot.filter ? '无匹配项 · Esc 清除筛选' : snapshot.completeness === 'partial' ? '部分结果 · 当前无可显示项' : '暂无项目', tone: 'gray' });
  if (snapshot.overlay) {
    const overlayHeight = Math.min(height - 2, Math.max(5, snapshot.overlay.fields.length + snapshot.overlay.impact.length + 4));
    return [...list.slice(0, Math.max(2, height - overlayHeight)), ...formLines(snapshot.overlay, width, overlayHeight)];
  }
  return list;
}

/** Pure terminal presentation; adapters and native Provider differences stay outside this layer. */
export function TuiScreen({ snapshot, resource, version }: { snapshot: TuiSnapshot; resource: TuiResource; version: string }) {
  const width = Math.max(1, snapshot.viewport.columns);
  const height = Math.max(1, snapshot.viewport.rows);
  const bodyHeight = Math.max(1, height - 8);
  const permission = snapshot.context ? snapshot.context.permissionLabel ?? (snapshot.context.kind === 'local' ? '本机用户' : '未认证') : '选择连接';
  const top: Line[] = [
    { text: `crosschat ${version} · ${snapshot.context?.label ?? 'ctx'} · 权限：${permission}`, tone: 'cyan' },
    { text: snapshot.input ? `${snapshot.input.kind === 'command' ? ':' : '/'}${editingLine(snapshot.input.editor.text, snapshot.input.editor.cursor, width - 1)}` : `:${resource.id}  ${resource.label}${snapshot.filter ? `  /${snapshot.filter}` : ''}` },
  ];
  const candidates = snapshot.input?.candidates ?? [];
  const chosen = snapshot.input?.candidateIndex;
  const candidateStart = chosen === undefined ? 0 : Math.max(0, chosen - 1);
  for (let index = 0; index < 2; index++) {
    const candidate = candidates[candidateStart + index];
    top.push(candidate ? { text: `${chosen === candidateStart + index ? '›' : ' '} :${candidate.id}  ${candidate.label}${candidate.enabled ? '' : ` · ${candidate.reason ?? '不可用'}`}`, tone: 'cyan' } : { text: index === 0 ? snapshot.input?.hint ?? '输入 : 切换资源并筛选；/ 仅筛选当前列表' : '' , tone: 'gray' });
  }
  // Even a full two-line completion list must explain what Enter does.
  if (snapshot.input && candidates.length >= 2) top[3] = { ...top[3], text: `${top[3].text} · ${snapshot.input.hint}` };
  const body = bodyLines(snapshot, resource, width, bodyHeight);
  while (body.length < bodyHeight) body.push({ text: '' });
  const completeness = { complete: '完整', partial: '部分结果', unavailable: '尚未启用', cancelled: '已取消' }[snapshot.completeness];
  const footer: Line[] = [
    { text: `${snapshot.rows.length ? `${snapshot.selectedIndex + 1}/${snapshot.rows.length}` : '0项'} · ${completeness}${snapshot.loading ? ' · 读取中' : ''}${snapshot.filter ? ` · 筛选 ${snapshot.filter}` : ''}`, tone: 'gray' },
    { text: snapshot.error ?? snapshot.overlay?.error ?? snapshot.notice ?? '', tone: snapshot.error || snapshot.overlay?.error ? 'red' : 'yellow' },
    { text: [...snapshot.actions].sort((left, right) => {
      const priority = ['enter-context', 'detail', 'copy', 'refresh', 'sort', 'help'];
      const rank = (id: string) => priority.includes(id) ? priority.indexOf(id) : 10;
      return rank(left.id) - rank(right.id);
    }).map((action) => `${action.shortcut} ${action.label}${action.enabled ? '' : '(不可用)'}`).join('  '), tone: 'cyan' },
    { text: snapshot.input?.hint ?? '? 全部按键  : 资源/筛选  Esc 返回  q 退出  Ctrl+C 取消读取/退出', tone: 'gray' },
  ];
  const lines = height < 10 ? [{ text: '终端太小 · 请放大 · q退出', tone: 'yellow' as const }, ...top.slice(0, Math.max(0, height - 1))] : [...top, ...body.slice(0, bodyHeight), ...footer];
  return <Box width={width} height={height} flexDirection="column" overflow="hidden">
    {lines.slice(0, height).map((line, index) => <Box key={index} height={1} flexShrink={0} width={width}><Text wrap="truncate" color={line.tone} backgroundColor={line.selected ? 'blue' : undefined}>{clipText(line.text, width) || ' '}</Text></Box>)}
  </Box>;
}

function normalizeKey(input: string, key: Key): TuiKey {
  const names: readonly [boolean, string][] = [[key.upArrow, 'up'], [key.downArrow, 'down'], [key.leftArrow, 'left'], [key.rightArrow, 'right'], [key.pageUp, 'pageup'], [key.pageDown, 'pagedown'], [key.home, 'home'], [key.end, 'end'], [key.return, 'enter'], [key.escape, 'escape'], [key.tab, 'tab'], [key.backspace, 'backspace'], [key.delete, 'delete']];
  const name = names.find(([pressed]) => pressed)?.[1];
  return { name: name ?? input, text: name ? undefined : input, ctrl: key.ctrl, shift: key.shift, alt: key.meta };
}

export function TuiApp({ controller, registry, version, onError }: { controller: Controller; registry: ResourceRegistry; version: string; onError(error: unknown): void }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const size = useWindowSize();
  useEffect(() => { controller.resize(size.columns, size.rows); }, [controller, size.columns, size.rows]);
  useInput((input, key) => { try { controller.handleKey(normalizeKey(input, key)); } catch (error) { onError(error); } });
  usePaste((text) => { try { controller.handleKey({ name: 'paste', text }); } catch (error) { onError(error); } });
  const resource = registry.resolve(snapshot.route.resourceId);
  if (!resource) throw new Error('未登记的资源');
  return <TuiScreen snapshot={snapshot} resource={resource} version={version} />;
}
