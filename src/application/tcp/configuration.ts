export interface TcpConfigurationTarget {
  contextId: string;
  starId: string;
  name: string | null;
  host: string;
  port: number;
}
export interface TcpConfigurationPreview {
  enabled: boolean;
  revision: string;
  targets: TcpConfigurationTarget[];
  impact: string[];
  message: string;
  reason?: string;
}
export interface TcpConfigurationResult {
  status: 'applied' | 'blocked' | 'changed' | 'cancelled' | 'failed';
  message: string;
  targets: TcpConfigurationTarget[];
  contextId?: string;
}
export interface TcpConfigurationImportOptions {
  baseDir: string;
  /** Atomic replacement seam for isolated filesystem failures. */
  renameFile?: (from: string, to: string) => void;
}
export interface TcpConfigurationImport {
  preview(request: { content: string; signal?: AbortSignal }): Promise<TcpConfigurationPreview>;
  apply(request: { content: string; expectedRevision: string; signal?: AbortSignal }): Promise<TcpConfigurationResult>;
}

/** Private secret input; the returned plan contains only connection metadata. */
export function createTcpConfiguration(_options: TcpConfigurationImportOptions): TcpConfigurationImport {
  return {
    async preview() { throw new Error('TCP configuration preview not implemented'); },
    async apply() { throw new Error('TCP configuration import not implemented'); },
  };
}
