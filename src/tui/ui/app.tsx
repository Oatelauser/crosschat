import { Component, useEffect, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { Box, Text, useInput, usePaste, useWindowSize } from 'ink';
import type { createTuiController } from '../app/controller.js';
import { detailLines } from '../app/detail.js';
import { helpLines } from '../app/help.js';
import { formContentLines } from '../app/form.js';
import type { ResourceRegistry } from '../resources/registry.js';
import type { TuiOverlay, TuiResource, TuiSnapshot } from '../model.js';
import { clipText, displayWidth, editorViewport, sanitizeTerminalText } from './text.js';
import { formatTable } from './table.js';
import { inputKeys } from './input.js';

type Controller = ReturnType<typeof createTuiController>;
interface Line { text: string; selected?: boolean; tone?: 'cyan' | 'yellow' | 'red' | 'gray' }
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
function formFits(snapshot: TuiSnapshot): boolean { return snapshot.viewport.columns >= 24 && snapshot.viewport.rows >= 16; }

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
  const content = formContentLines(overlay, width);
  const capacity = Math.max(1, height - 2);
  const start = Math.max(0, Math.min(overlay.scrollOffset ?? 0, content.length - capacity));
  const lines: Line[] = [{ text: `${overlay.title} · ${overlay.checking ? '核验中' : overlay.phase === 'submitting' ? '提交中' : overlay.phase === 'confirming' ? '确认影响' : '填写'} · ${start + 1}/${content.length}`, tone: 'cyan' }];
  for (const line of content.slice(start, start + capacity)) {
    if (line.fieldIndex === undefined) {
      lines.push({ text: line.text, tone: line.kind === 'error' ? 'red' : line.kind === 'impact' ? 'yellow' : 'gray' });
      continue;
    }
    const field = overlay.fields[line.fieldIndex];
    const prefix = `${clipText(field.label, Math.max(2, Math.floor(width / 3)))}: `;
    const focused = overlay.focusIndex === line.fieldIndex;
    const label = field.options?.find((option) => option.value === field.value)?.label ?? field.value;
    const value = field.secret ? '•'.repeat(Array.from(segmenter.segment(field.value)).length) : field.options ? `‹${label}› ↑↓选择` : field.value;
    const cursor = field.cursor ?? Array.from(segmenter.segment(value)).length;
    lines.push({ text: prefix + (focused && overlay.phase === 'editing' && !field.options ? editingLine(value, cursor, Math.max(0, width - displayWidth(prefix))) : sanitizeTerminalText(value)), selected: focused });
  }
  while (lines.length < height - 1) lines.push({ text: '' });
  lines.push({ text: overlay.phase === 'submitting' ? 'Esc停止等待 · 结果待核实' : `${overlay.focusIndex === overlay.fields.length ? '›' : ' '}[取消]  ${overlay.focusIndex === overlay.fields.length + 1 ? '›' : ' '}[${overlay.checking ? '核验中' : '确认提交'}]`, tone: 'cyan' });
  return lines;
}

function bodyLines(snapshot: TuiSnapshot, resource: TuiResource, width: number, height: number): Line[] {
  if (snapshot.result) {
    return [{ text: `${snapshot.result.title} · 一次性结果`, tone: 'yellow' },
      ...detailLines(snapshot.result.fields, Math.max(1, width - 2)).slice(snapshot.result.scrollOffset, snapshot.result.scrollOffset + height - 1).map((line) => ({ text: line.text }))];
  }
  if (snapshot.help) {
    return [{ text: `${snapshot.help.title} · 全部按键`, tone: 'cyan' }, ...helpLines(snapshot.help.entries, width).slice(snapshot.help.scrollOffset, snapshot.help.scrollOffset + height - 1).map((line) => ({
      text: line.text,
      tone: line.enabled ? undefined : 'gray' as const,
    }))];
  }
  if (snapshot.detail && snapshot.mode !== 'form') {
    const detail = snapshot.detail;
    return [{ text: `${detail.title} · 只读详情${detail.query ? ` /${detail.query}` : ''}`, tone: 'cyan' },
      ...detailLines(detail.fields, Math.max(1, width - 2)).slice(detail.scrollOffset, detail.scrollOffset + height - 1).map((line) => ({
        text: `${line.fieldIndex === detail.selectedIndex ? '› ' : '  '}${line.text}`, selected: line.fieldIndex === detail.selectedIndex,
      }))];
  }
  if (snapshot.choice) {
    const choice = snapshot.choice;
    return [{ text: `${choice.title} · Enter应用 / Esc撤销`, tone: 'cyan' }, ...choice.options.slice(choice.scrollOffset, choice.scrollOffset + height - 1).map((option, index) => ({
      text: `${choice.selectedIndex === choice.scrollOffset + index ? '›' : ' '} ${option.label}${option.enabled === false ? ' (不可用)' : ''}`,
      selected: choice.selectedIndex === choice.scrollOffset + index,
      tone: option.enabled === false ? 'gray' as const : undefined,
    }))];
  }
  const table = formatTable({ columns: resource.columns, rows: snapshot.rows, width: Math.max(0, width - 2) });
  const list: Line[] = [{ text: `  ${table.header}`, tone: 'cyan' }];
  if (table.rows.length) {
    for (const row of table.rows.slice(snapshot.scrollOffset, snapshot.scrollOffset + height - 1)) {
      list.push({ text: `${row.id === snapshot.selectedId ? '› ' : '  '}${row.text}`, selected: row.id === snapshot.selectedId });
    }
  } else {
    const filtered = Boolean(snapshot.filter) || snapshot.filters?.some((filter) => (snapshot.selectedFacets?.[filter.id] ?? filter.defaultValue) !== filter.defaultValue);
    const unavailable = resource.unavailableReason ? '资源尚未启用 · :ctx 返回连接' : '读取不可用 · i查看读取信息 / r刷新';
    list.push({ text: snapshot.loading ? '正在读取… Ctrl+C 取消' : snapshot.completeness === 'unavailable' ? unavailable : snapshot.completeness === 'cancelled' ? '读取已取消 · 当前结果不完整，r重新读取' : snapshot.completeness === 'partial' ? '部分结果 · 当前无可显示项，i查看读取信息' : filtered ? '无匹配项 · Esc 清除筛选' : '暂无项目', tone: 'gray' });
  }
  if (snapshot.overlay) {
    if (!formFits(snapshot)) return [...list.slice(0, 2), { text: '请放大终端至24列×16行后编辑；Esc取消', tone: 'yellow' }];
    return [...list.slice(0, 2), ...formLines(snapshot.overlay, width, height - 2)];
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
    { text: snapshot.input ? `${snapshot.input.kind === 'command' ? ':' : '/'}${editingLine(snapshot.input.editor.text, snapshot.input.editor.cursor, width - 1)}` : `:${resource.id}  ${resource.label}${snapshot.following === undefined ? '' : snapshot.following ? ' · 跟随中' : ' · 已暂停'}${snapshot.autoRefreshing === undefined ? '' : snapshot.autoRefreshing ? ' · 自动刷新' : ' · 刷新已暂停'}${snapshot.filter ? `  /${snapshot.filter}` : ''}${snapshot.sampledAt === undefined ? '' : ` · 采样 ${new Date(snapshot.sampledAt).toLocaleTimeString()}`}` },
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
  if (!snapshot.input && snapshot.filters?.length) {
    top[2] = { text: snapshot.filters.map((filter) => {
      const value = snapshot.selectedFacets?.[filter.id] ?? filter.defaultValue;
      return `${filter.label}：${filter.options.find((option) => option.value === value)?.label ?? value}`;
    }).join('  '), tone: 'cyan' };
  }
  const body = bodyLines(snapshot, resource, width, bodyHeight);
  while (body.length < bodyHeight) body.push({ text: '' });
  const completeness = { complete: '完整', partial: '部分结果', unavailable: '不可用', cancelled: '已取消' }[snapshot.completeness];
  const footer: Line[] = [
    { text: `${snapshot.rows.length ? `${snapshot.selectedIndex + 1}/${snapshot.rows.length}` : '0项'}${snapshot.totalRows !== undefined && snapshot.totalRows !== snapshot.rows.length ? ` / 发现${snapshot.totalRows}项` : ''} · ${completeness}${snapshot.loading ? ' · 读取中' : ''}${snapshot.filter ? ` · 筛选 ${snapshot.filter}` : ''}`, tone: 'gray' },
    { text: snapshot.result?.notice ?? snapshot.choice?.options[snapshot.choice.selectedIndex]?.reason ?? snapshot.error ?? snapshot.overlay?.error ?? snapshot.notice ?? '', tone: snapshot.error || snapshot.overlay?.error ? 'red' : 'yellow' },
    { text: [...snapshot.actions].sort((left, right) => {
      const priority = ['enter-context', 'detail', 'copy', 'refresh', 'sort', 'help'];
      const rank = (id: string) => priority.includes(id) ? priority.indexOf(id) : 10;
      return rank(left.id) - rank(right.id);
    }).map((action) => `${action.shortcut} ${action.label}${action.enabled ? '' : '(不可用)'}`).join('  '), tone: 'cyan' },
    { text: snapshot.input?.hint ?? snapshot.actions.filter((entry) => ['help', 'quit', 'back', 'interrupt', 'form-cancel', 'field-enter'].includes(entry.id)).map((entry) => `${entry.shortcut} ${entry.label}`).join('  '), tone: 'gray' },
  ];
  const lines = height < 10 ? [{ text: snapshot.mode === 'form' ? '请放大终端 · Esc取消' : '终端太小 · 请放大 · Ctrl+C取消/退出', tone: 'yellow' as const }, ...top.slice(0, Math.max(0, height - 1))] : [...top, ...body.slice(0, bodyHeight), ...footer];
  return <Box width={width} height={height} flexDirection="column" overflow="hidden">
    {lines.slice(0, height).map((line, index) => <Box key={index} height={1} flexShrink={0} width={width}><Text wrap="truncate" color={line.tone} backgroundColor={line.selected ? 'blue' : undefined}>{clipText(line.text, width) || ' '}</Text></Box>)}
  </Box>;
}

interface AppProps { controller: Controller; registry: ResourceRegistry; version: string; onError(error: unknown): void }

// Keep exception messages and component stacks out of Ink's default error screen.
class RenderBoundary extends Component<{ children: ReactNode; onError(error: unknown): void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { this.props.onError(error); }
  render() { return this.state.failed ? null : this.props.children; }
}

function TuiRuntime({ controller, registry, version, onError }: AppProps) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const size = useWindowSize();
  useEffect(() => { controller.resize(size.columns, size.rows); }, [controller, size.columns, size.rows]);
  useInput((input, key) => {
    try {
      for (const event of inputKeys(input, key)) {
        const current = controller.getSnapshot();
        if (current.mode === 'form' && !formFits(current) && event.name !== 'escape' && !(event.ctrl && event.name === 'c')) continue;
        controller.handleKey(event);
      }
    } catch (error) { onError(error); }
  });
  usePaste((text) => {
    const current = controller.getSnapshot();
    if (current.mode === 'form' && !formFits(current)) return;
    try { controller.handleKey({ name: 'paste', text }); } catch (error) { onError(error); }
  });
  const resource = registry.resolve(snapshot.route.resourceId);
  if (!resource) throw new Error('未登记的资源');
  return <TuiScreen snapshot={snapshot} resource={snapshot.resource ?? resource} version={version} />;
}

export function TuiApp(props: AppProps) {
  return <RenderBoundary onError={props.onError}><TuiRuntime {...props} /></RenderBoundary>;
}
