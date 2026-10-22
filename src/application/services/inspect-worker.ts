import { parentPort, workerData } from 'node:worker_threads';
import { closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { MultichatError } from '../../errors.js';
import { DEFAULT_PORT } from '../../serve/broker.js';
import { tcpDir } from '../../serve/registry.js';
import { guardSameStarDaemon } from './guard.js';
import { connectValueOf, listServeProcesses, pidsOnPort } from './processes.js';

function readBrokerMetadata(file: string): unknown {
  const limit = 2 * 1024 * 1024;
  const metadata = lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Invalid broker metadata source');
  const descriptor = openSync(file, 'r');
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.size > limit) throw new Error('Broker metadata exceeds its limit');
    const buffer = Buffer.alloc(Math.min(info.size + 1, limit + 1));
    const bytes = readSync(descriptor, buffer, 0, buffer.length, 0);
    if (bytes > limit) throw new Error('Broker metadata exceeds its limit');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes))) as unknown;
  } finally { closeSync(descriptor); }
}

if (parentPort === null) throw new Error('服务核验须由专属 worker 启动');
try {
  const input: unknown = workerData;
  if (input === null || typeof input !== 'object' || !('baseDir' in input) || typeof input.baseDir !== 'string' || !('request' in input)
    || input.request === null || typeof input.request !== 'object' || !('kind' in input.request)) throw new Error('服务核验请求形状无效');
  const request = input.request;
  if (request.kind === 'guard' && 'selector' in request && typeof request.selector === 'string') {
    try { guardSameStarDaemon(request.selector, { baseDir: input.baseDir }); parentPort.postMessage({ allowed: true }); }
    catch (error) { parentPort.postMessage({ allowed: false, reason: error instanceof MultichatError ? error.message : '无法核验同星服务占用' }); }
  } else if (request.kind === 'inspect') {
    const processes = listServeProcesses();
    let port: number | undefined = DEFAULT_PORT;
    try {
      const value = readBrokerMetadata(join(tcpDir(input.baseDir), 'broker.json'));
      if (value === null || typeof value !== 'object' || !('stars' in value) || !Array.isArray(value.stars)) throw new Error('Invalid broker metadata');
      if ('port' in value) {
        if (typeof value.port !== 'number' || !Number.isInteger(value.port)) throw new Error('Invalid broker port');
        port = value.port;
      }
    } catch (error) {
      if (error === null || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') port = undefined;
    }
    // Port metadata failure blocks broker confirmation without discarding independently identified node processes.
    const confirmed = port === undefined ? new Set<number>() : pidsOnPort(port);
    parentPort.postMessage({ state: 'ready', processes: processes.map((item) => item.cmdline.includes('--connect')
      ? { kind: 'node', pid: item.pid, selector: connectValueOf(item.cmdline) ?? '' } : { kind: 'broker', pid: item.pid }),
      confirmedBrokerPids: processes.filter((item) => !item.cmdline.includes('--connect') && confirmed.has(item.pid)).map((item) => item.pid) });
  } else throw new Error('服务核验请求形状无效');
} catch { parentPort.postMessage({ state: 'failed', processes: [], confirmedBrokerPids: [], message: '无法核验本机服务进程' }); }
finally { parentPort.close(); }
