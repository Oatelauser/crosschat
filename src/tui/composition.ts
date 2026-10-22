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
import { queryManagedFiles } from '../application/queries/files.js';
import type { TuiActionRequest, TuiReadRequest, TuiResource, TuiResourceAdapter } from './model.js';
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
export function createDefaultResources(options: { home: string; isolatedHome: boolean }): { resources: readonly TuiResource[]; adapters: Readonly<Record<string, TuiResourceAdapter>> } {
  const { home, isolatedHome } = options;
  const baseDir = join(home, '.crosschat');
  const env = childEnvironment(home, isolatedHome);
  const discovery = createLocalDiscoveryService(isolatedHome ? { home } : {});
  const membership = createSessionMembershipService({ baseDir, discovery });
  const overview = createLocalOverview({ home, discovery, nativeEnvironment: isolatedHome ? 'isolated' : 'inherit' });
  const ssh = createSshApplication({ home });
  const sessions = createSessionsResource({ discovery, membership, relatedResources: ['deliveries', 'logs'] });
  const doctor = createDoctorResource({ overview });
  const remoteSessions = createSshSessionsResource({ ssh });
  const remoteDoctor = createSshDoctorResource({ ssh });
  const communications = createCommunicationResources({
    readCommunications: ({ contextId, signal }) => queryCommunications({ baseDir, contextId, signal }),
    readOutbox: ({ contextId, signal }) => queryOutbox({ baseDir, contextId, signal }),
  });
  const installed = [
    { resource: sessions.resource, adapter: byContext({ local: sessions.adapter, ssh: remoteSessions.adapter }) },
    { resource: doctor.resource, adapter: byContext({ local: doctor.adapter, ssh: remoteDoctor.adapter }) },
    createStatusResource({ overview }), communications.deliveries, communications.outbox,
    createLogsResource({ read: (request) => queryManagedLog({ ...request, baseDir }) }),
    createServicesResource({ service: createLocalServices({ baseDir, env, entryPath: fileURLToPath(new URL('../cli.js', import.meta.url)) }) }),
    createFilesResource({ read: ({ signal }) => queryManagedFiles({ baseDir, signal }) }),
    createMaintenanceResource({ maintenance: createLocalMaintenance({ home, env }) }),
    createSshResource({ ssh }),
  ];
  const resources = new Map(installed.map((item) => [item.resource.id, item.resource]));
  resources.set(contextsResource.id, contextsResource);
  return { resources: defaultResources.map((resource) => resources.get(resource.id) ?? resource), adapters: Object.fromEntries(installed.map((item) => [item.resource.id, item.adapter])) };
}
