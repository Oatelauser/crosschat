import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createLocalDiscoveryService } from '../application/discovery/local.js';
import { createSessionMembershipService } from '../application/session-membership/index.js';
import { queryCommunications, queryOutbox } from '../application/observations/communications.js';
import { queryManagedLog } from '../application/observations/logs.js';
import { createLocalOverview } from '../application/observations/overview.js';
import { createLocalServices } from '../application/services/managed.js';
import { createLocalMaintenance } from '../application/maintenance/index.js';
import { createSshApplication } from '../application/ssh/index.js';
import type { SshChallengeHandler } from '../application/ssh/index.js';
import { createTcpApplication } from '../application/tcp/index.js';
import { createTcpManagement } from '../application/tcp/management.js';
import { createTcpConfiguration } from '../application/tcp/configuration.js';
import { queryManagedFiles } from '../application/queries/files.js';
import type { TuiActionRequest, TuiReadRequest, TuiResource, TuiResourceAdapter, TuiPage, TuiRow } from './model.js';
import { contextsResource } from './resources/contexts.js';
import { defaultResources } from './resources/registry.js';
import { createSessionsResource } from './resources/sessions.js';
import { createStatusResource, createDoctorResource } from './resources/overview.js';
import { createCommunicationResources } from './resources/communications.js';
import { createLogsResource } from './resources/logs.js';
import { createServicesResource } from './resources/services.js';
import { createFilesResource } from './resources/files.js';
import { createMaintenanceResource } from './resources/maintenance.js';
import { createSshResource, createSshDoctorResource, createSshSessionsResource } from './resources/ssh.js';
import { createTcpResources } from './resources/tcp.js';
import { createConnectionsResource, createTcpTargetsResource } from './resources/connections.js';

function childEnvironment(home: string, isolated: boolean): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (!isolated) return env;
  for (const key of Object.keys(env)) if (['HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'APPDATA', 'CODEX_HOME', 'CODEX_SQLITE_HOME', 'CLAUDE_CONFIG_DIR'].includes(key.toUpperCase())) delete env[key];
  return { ...env, HOME: home, USERPROFILE: home, LOCALAPPDATA: join(home, 'AppData', 'Local'), APPDATA: join(home, 'AppData', 'Roaming'), CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude') };
}

/** Choose an explicit context adapter for every request; remote errors never select local IO. */
function byContext(adapters: Readonly<Record<string, TuiResourceAdapter>>): TuiResourceAdapter {
  const select = (request: TuiReadRequest | TuiActionRequest): TuiResourceAdapter | undefined => {
    const context = request.context;
    if (!context || !Object.hasOwn(adapters, context.kind)) return undefined;
    if ('route' in request && request.route?.contextId !== undefined && request.route.contextId !== context.id) return undefined;
    return adapters[context.kind];
  };
  return {
    async read(request) {
      const adapter = select(request);
      return adapter ? adapter.read(request) : { rows: [], completeness: 'unavailable', notice: '此连接没有提供当前资源；返回 :ctx 选择支持的连接。' };
    },
    ...(Object.values(adapters).some((adapter) => adapter.describeActions) ? { async describeActions(request: TuiReadRequest & { target: TuiRow }) {
      return select(request)?.describeActions?.(request) ?? {};
    } } : {}),
    ...(Object.values(adapters).some((adapter) => adapter.watch) ? { async watch(request: TuiReadRequest, publish: (page: TuiPage) => void) {
      const observe = select(request)?.watch;
      if (!observe) throw new Error('此连接未提供当前资源的观察入口。');
      return observe(request, publish);
    } } : {}),
    ...(Object.values(adapters).some((adapter) => adapter.checkAction) ? { async checkAction(request: TuiActionRequest) {
      const adapter = select(request);
      return adapter?.checkAction ? adapter.checkAction(request) : { enabled: false, reason: '此连接没有提供所选操作。', nextStep: '返回操作所属的本机资源。' };
    } } : {}),
    ...(Object.values(adapters).some((adapter) => adapter.mutate) ? { async mutate(request: TuiActionRequest) {
      const adapter = select(request);
      if (!adapter?.mutate) throw new Error('此连接没有提供所选操作；未改用本机执行。');
      return adapter.mutate(request);
    } } : {}),
  };
}

/** Only constructs adapters. Each application module owns its later IO and effects. */
export function createDefaultResources(options: { home: string; isolatedHome: boolean; onChallenge?: SshChallengeHandler }): { resources: readonly TuiResource[]; adapters: Readonly<Record<string, TuiResourceAdapter>>; shouldSavePreferences(): boolean; setActiveContext(id: string | null): void; dispose(): Promise<void> } {
  const { home, isolatedHome } = options;
  const baseDir = join(home, '.crosschat');
  const env = childEnvironment(home, isolatedHome);
  const discovery = createLocalDiscoveryService(isolatedHome ? { home } : {});
  const membership = createSessionMembershipService({ baseDir, discovery });
  const overview = createLocalOverview({ home, discovery, nativeEnvironment: isolatedHome ? 'isolated' : 'inherit' });
  const ssh = createSshApplication({ home, onChallenge: options.onChallenge, ...(isolatedHome ? { configFile: join(home, '.ssh', 'config'), env } : {}) });
  const sessions = createSessionsResource({ discovery, membership, relatedResources: ['deliveries', 'logs'] });
  const doctor = createDoctorResource({ overview });
  const remoteSessions = createSshSessionsResource({ ssh });
  const remoteDoctor = createSshDoctorResource({ ssh });
  const tcp = createTcpApplication({ baseDir });
  const services = createLocalServices({ baseDir, env, entryPath: fileURLToPath(new URL('../cli.js', import.meta.url)) });
  const tcpResources = createTcpResources({ tcp, management: createTcpManagement({ baseDir, catalog: tcp, membership, discovery }), services });
  const ordinarySessions = byContext({ local: sessions.adapter, ssh: remoteSessions.adapter, tcp: tcpResources.sessions.adapter });
  const sessionAdapter = (request: TuiReadRequest | TuiActionRequest) => request.context?.kind === 'local' && request.route?.query?.starId !== undefined ? tcpResources.sessions.adapter : ordinarySessions;
  const allSessions: TuiResourceAdapter = {
    read: (request) => sessionAdapter(request).read(request),
    async describeActions(request) { return sessionAdapter(request).describeActions?.(request) ?? {}; },
    async watch(request, publish) { const observe = sessionAdapter(request).watch; if (!observe) throw new Error('当前连接未提供会话观察。'); return observe(request, publish); },
    async checkAction(request) { return sessionAdapter(request).checkAction?.(request) ?? { enabled: false, reason: '当前连接未提供此会话操作。' }; },
    async mutate(request) { const apply = sessionAdapter(request).mutate; if (!apply) throw new Error('当前连接未提供此会话操作。'); return apply(request); },
  };
  const maintenance = createLocalMaintenance({ home, env });
  let savePreferences = true;
  let uninstallGeneration = 0;
  const communications = createCommunicationResources({
    readCommunications: ({ contextId, signal }) => queryCommunications({ baseDir, contextId, signal }),
    readOutbox: ({ contextId, signal }) => queryOutbox({ baseDir, contextId, signal }),
  });
  const installed = [
    { resource: sessions.resource, adapter: allSessions },
    { resource: doctor.resource, adapter: byContext({ local: doctor.adapter, ssh: remoteDoctor.adapter }) },
    createStatusResource({ overview }), communications.deliveries, communications.outbox,
    createLogsResource({ read: (request) => queryManagedLog({ ...request, baseDir }) }),
    createServicesResource({ service: services }),
    createFilesResource({ read: ({ signal }) => queryManagedFiles({ baseDir, signal }) }),
    createMaintenanceResource({ maintenance: { ...maintenance, async execute(request) {
      if (request.operationId !== 'uninstall-data' || request.signal?.aborted) return maintenance.execute(request);
      const before = savePreferences;
      const generation = ++uninstallGeneration;
      // Even a lost reply may follow successful data removal. Exit must not
      // recreate the directory; only a confirmed zero-effect rejection restores it.
      savePreferences = false;
      const result = await maintenance.execute(request);
      if (generation === uninstallGeneration && (result.status === 'blocked' || result.status === 'changed') && result.items.length === 0) savePreferences = before;
      return result;
    } } }),
    createSshResource({ ssh }),
    tcpResources.stars, tcpResources.machines, tcpResources.members, tcpResources.keys,
    createConnectionsResource({ configuration: createTcpConfiguration({ baseDir }) }),
    createTcpTargetsResource({ configuration: createTcpConfiguration({ baseDir }) }),
  ];
  const resources = new Map(installed.map((item) => [item.resource.id, item.resource]));
  resources.set(contextsResource.id, contextsResource);
  return { resources: defaultResources.map((resource) => resources.get(resource.id) ?? resource), adapters: Object.fromEntries(installed.map((item) => [item.resource.id, item.adapter])), shouldSavePreferences: () => savePreferences,
    setActiveContext: (id) => ssh.setActiveContext(id?.startsWith('ssh:') ? id : null), dispose: () => ssh.dispose() };
}
