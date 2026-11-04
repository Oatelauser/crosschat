import process from 'node:process';

export interface SendCommandTarget {
  tool: string;
  to?: string;
  via?: string;
}

const hasControls = (value: string): boolean => [...value].some((char) => {
  const codepoint = char.codePointAt(0)!;
  return codepoint < 0x20 || (codepoint >= 0x7f && codepoint <= 0x9f);
});

function quote(value: string, platform: NodeJS.Platform): string {
  if (/^[\p{L}\p{N}._:/@+-]+$/u.test(value) && !(platform === 'win32' && value.startsWith('@'))) return value;
  return platform === 'win32' ? `'${value.replaceAll("'", "''")}'` : `'${value.replaceAll("'", "'\\''")}'`;
}

/** Copy a command for the shell running the TUI; native IDs remain literal values. */
export function formatSendCommand(target: SendCommandTarget, platform = process.platform): string | undefined {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(target.tool) || (target.to === undefined && target.via === undefined)
    || [target.to, target.via].some((value) => value !== undefined && (value === '' || hasControls(value)))) return undefined;
  return `crosschat send${target.via === undefined ? '' : ` --via ${quote(target.via, platform)}`}`
    + `${target.to === undefined ? '' : ` --to ${quote(target.to, platform)}`}`
    + ` --tool ${target.tool} --body "<正文>"`;
}
