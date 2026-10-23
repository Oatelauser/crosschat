export interface DshOptions {
  home?: string;
  instancesDir?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface DshThread {
  id: string;
  name: string | null;
  cwd: string;
  rawStatus: { type: 'idle' | 'running' };
  attributes: Readonly<Record<string, unknown>>;
}

export interface DshPageOptions extends DshOptions { cursor?: string; limit?: number }
export interface DshThreadPage { data: DshThread[]; nextCursor: string | null; completeness: 'complete' | 'partial' }

export async function listDshThreads(_options: DshOptions = {}): Promise<DshThread[]> { throw new Error('DSH adapter not implemented'); }
export async function listDshThreadPage(_options: DshPageOptions = {}): Promise<DshThreadPage> { throw new Error('DSH adapter not implemented'); }
export async function getDshThread(_id: string, _options: DshOptions = {}): Promise<DshThread | null> { throw new Error('DSH adapter not implemented'); }
