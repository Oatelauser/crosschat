import type { TuiActionEntry, TuiResource, TuiSnapshot } from '../model.js';
import { clipText, displayWidth } from './text.js';

export interface ScreenLine { text: string; selected?: boolean; tone?: 'cyan' | 'yellow' | 'red' | 'gray'; parts?: readonly { text: string; tone?: ScreenLine['tone'] }[] }
const logo = ['  ___  ___ ', ' / __|/ __|', '| (__| (__ ', ' \\___|\\___|'];
function pad(text: string, width: number): string { const value = clipText(text, width); return value + ' '.repeat(Math.max(0, width - displayWidth(value))); }

export function keyHints(snapshot: TuiSnapshot, resource: TuiResource): readonly TuiActionEntry[] {
  if (snapshot.mode !== 'list') return snapshot.actions.slice(0, 8);
  const definitions = new Map(resource.actions.map((action) => [action.id, action]));
  const rank = (entry: TuiActionEntry) => {
    const action = definitions.get(entry.id);
    return action?.mutation ? 0 : action?.kind === 'navigate' ? 1 : action?.kind === 'route-choice' ? 2 : action?.kind === 'filter' ? 3 : action?.kind === 'detail' ? 4 : 5;
  };
  const own = snapshot.actions.filter((entry) => definitions.has(entry.id)).sort((a, b) => rank(a) - rank(b));
  const views = own.filter((entry) => ['1', '2', '3'].includes(entry.shortcut));
  const visible = own.filter((entry) => !views.includes(entry));
  if (views.length === 3) visible.unshift({ id: 'view-hints', shortcut: '1/2/3', label: '成员/节点/会话', enabled: true });
  for (const id of ['detail', 'refresh']) {
    const entry = snapshot.actions.find((action) => action.id === id);
    if (entry && !visible.some((action) => action.id === id)) visible.push(entry);
  }
  const help = snapshot.actions.find((entry) => entry.id === 'help');
  return [...visible.slice(0, help ? 7 : 8), ...(help ? [help] : [])];
}

/** Width budgets choose complete action slots before text clipping; the help slot is reserved. */
export function headerLines(snapshot: TuiSnapshot, resource: TuiResource, version: string, width: number, maxHeight: number): ScreenLine[] {
  const permission = snapshot.context?.permissionLabel ?? (snapshot.context?.kind === 'local' ? '本机用户' : snapshot.context ? '未认证' : '尚未选择');
  const verification = snapshot.authorization?.state === 'checking' ? '正在核验' : snapshot.authorization?.state === 'verified' ? '已核验' : snapshot.authorization?.state === 'stale' ? '上次核验' : snapshot.context ? '未认证' : '全局只读';
  const workspace = { local: '本机', ssh: 'SSH', tcp: 'TCP' };
  const info = [
    `CC · 工作区: ${snapshot.workspaceId ? workspace[snapshot.workspaceId] : '全局看板'} · ${resource.id}`,
    `目标: ${snapshot.context?.target ?? snapshot.context?.label ?? '选择目标进入工作区'}`,
    `角色: ${['checking', 'stale'].includes(snapshot.authorization?.state ?? '') && snapshot.context?.permissionLabel ? '上次 ' : ''}${permission}`,
    `核验: ${verification}${snapshot.sampledAt ? ` · 采样 ${new Date(snapshot.sampledAt).toLocaleTimeString()}` : ''}`,
    `当前: ${snapshot.context?.label ?? resource.label}`,
    `版本: ${version}`,
  ];
  if (snapshot.filters?.length) info[5] = snapshot.filters.map((filter) => {
    const value = snapshot.selectedFacets?.[filter.id] ?? filter.defaultValue;
    return `${filter.label}: ${filter.options.find((option) => option.value === value)?.label ?? value}`;
  }).join(' · ');
  let actions = keyHints(snapshot, resource);
  const hint = (action: TuiActionEntry) => `<${action.shortcut.split(' / ')[0]}> ${action.label}${action.enabled ? '' : ' ×'}`;
  let lines: ScreenLine[];
  if (width < 72) {
    const count = Math.max(1, Math.min(4, maxHeight - 3));
    const help = actions.find((entry) => entry.id === 'help');
    const selected = [...actions.filter((entry) => entry.id !== 'help').slice(0, Math.max(0, count - (help ? 1 : 0))), ...(help ? [help] : [])];
    lines = [info[0], info[1], `${info[2]} · ${verification}`].map((text) => ({ text, tone: 'yellow' }));
    lines.push(...selected.map((action) => ({ text: hint(action), tone: action.enabled ? 'cyan' as const : 'gray' as const })));
  } else {
    const left = Math.min(42, Math.max(26, Math.floor(width * 0.32)));
    const logoWidth = width >= 128 ? 13 : 0;
    const actionWidth = width - left - 2 - logoWidth;
    const columns = Math.max(1, Math.floor(actionWidth / 25));
    const slot = Math.floor(actionWidth / columns);
    const height = Math.min(maxHeight, Math.max(info.length, Math.ceil(actions.length / columns)));
    const capacity = height * columns;
    if (actions.length > capacity) {
      const help = actions.find((entry) => entry.id === 'help');
      actions = [...actions.filter((entry) => entry !== help).slice(0, Math.max(0, capacity - (help ? 1 : 0))), ...(help ? [help] : [])];
    }
    lines = Array.from({ length: height }, (_, row) => {
      const parts: NonNullable<ScreenLine['parts']>[number][] = [{ text: pad(info[row] ?? '', left) + '  ', tone: 'yellow' }];
      for (let column = 0; column < columns; column++) {
        const action = actions[row + column * height];
        parts.push({ text: pad(action ? hint(action) : '', slot), tone: action?.enabled === false ? 'gray' : 'cyan' });
      }
      if (logoWidth) parts.push({ text: pad(row === 0 ? 'CC' : logo[row - 1] ?? '', logoWidth), tone: 'yellow' });
      return { text: parts.map((part) => part.text).join(''), parts };
    });
  }
  if (snapshot.input) {
    // The command editor and its selected completion stay visible without hiding role/target.
    const chosen = snapshot.input.candidates[snapshot.input.candidateIndex ?? 0];
    lines = lines.slice(0, Math.max(3, maxHeight - 2));
    lines.push({ text: `${snapshot.input.kind === 'command' ? ':' : '/'}${snapshot.input.editor.text}▏`, tone: 'cyan' });
    lines.push({ text: `${chosen ? `:${chosen.id} ${chosen.label} · ` : ''}${snapshot.input.hint}`, tone: 'cyan' });
  }
  return lines.slice(0, maxHeight);
}

export function frameLines(content: readonly ScreenLine[], title: string, width: number, height: number): ScreenLine[] {
  if (width < 4 || height < 3) return content.slice(0, height);
  const caption = clipText(` ${title} `, width - 4);
  const right = Math.max(0, width - 2 - displayWidth(caption));
  const left = Math.floor(right / 2);
  const lines: ScreenLine[] = [{ text: `┌${'─'.repeat(left)}${caption}${'─'.repeat(right - left)}┐`, tone: 'cyan' }];
  for (let index = 0; index < height - 2; index++) {
    const line = content[index] ?? { text: '' };
    lines.push({ ...line, text: `│${pad(line.text, width - 2)}│` });
  }
  lines.push({ text: `└${'─'.repeat(width - 2)}┘`, tone: 'gray' });
  return lines;
}
