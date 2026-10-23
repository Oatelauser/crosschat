import { randomBytes } from 'node:crypto';
import { chmod, copyFile, link, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cancellable, isRecord } from '../queries/reading.js';

export interface SshAskpassBridge {
  environment: NodeJS.ProcessEnv;
  dispose(): Promise<void>;
}
interface AskpassOptions {
  answer(prompt: string, signal: AbortSignal): Promise<string | null>;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  temporaryRoot?: string;
}

// The helper has no persisted secret. Top-level await lets a Windows Node executable serve as ASKPASS
// through --import before Node tries to load OpenSSH's prompt as its main script.
const helperSource = String.raw`import { connect } from 'node:net';
const expected = process.env.CROSSCHAT_ASKPASS_EXECUTABLE;
if (!expected || process.execPath.toLowerCase() === expected.toLowerCase()) {
  // Node canonicalizes argv[1] as a filename on Windows before preloading. The in-memory
  // diagnostic header retains the original argument, including fingerprint '/' characters.
  const originalPrompt = expected ? process.report.getReport().header.commandLine.at(-1) : process.argv.at(-1);
  const finish = (code) => process.exit(code);
  await new Promise((resolve) => {
    let done = false;
    let input = '';
    const socket = connect({ host: '127.0.0.1', port: Number(process.env.CROSSCHAT_ASKPASS_PORT) });
    const fail = () => { if (done) return; done = true; socket.destroy(); resolve(); finish(1); };
    socket.setTimeout(120000, fail);
    socket.once('error', fail);
    socket.once('end', fail);
    socket.once('connect', () => socket.write(JSON.stringify({ token: process.env.CROSSCHAT_ASKPASS_TOKEN, prompt: originalPrompt }) + '\n'));
    socket.on('data', (chunk) => {
      if (done) return;
      input += chunk.toString('utf8');
      if (Buffer.byteLength(input) > 8192) { fail(); return; }
      const boundary = input.indexOf('\n');
      if (boundary < 0) return;
      try {
        const result = JSON.parse(input.slice(0, boundary));
        if (!result || typeof result.answer !== 'string' || !result.answer || Buffer.byteLength(result.answer) > 1023 || /[\r\n\0]/.test(result.answer)) { fail(); return; }
        done = true; socket.destroy();
        process.stdout.write(result.answer + '\n', () => { resolve(); finish(0); });
      } catch { fail(); }
    });
  });
}
`;
const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

/** A one-operation local capability owns all helper sockets and pending UI challenges. */
export async function createSshAskpassBridge(options: AskpassOptions): Promise<SshAskpassBridge> {
  const lifetime = new AbortController();
  const signal = options.signal ? AbortSignal.any([lifetime.signal, options.signal]) : lifetime.signal;
  if (signal.aborted) throw new Error('SSH authentication cancelled.');
  const directory = await mkdtemp(join(options.temporaryRoot ?? tmpdir(), 'crosschat-askpass-'));
  const sockets = new Set<Socket>();
  const token = randomBytes(32).toString('hex');
  let disposed = false;
  const server = createServer((socket) => {
    if (disposed || sockets.size >= 8) { socket.destroy(); return; }
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setTimeout(120_000, () => socket.destroy());
    let buffer = '';
    let accepted = false;
    socket.on('data', (chunk: Buffer) => {
      if (accepted) { socket.destroy(); return; }
      buffer += chunk.toString('utf8');
      if (Buffer.byteLength(buffer) > 20_000) { socket.destroy(); return; }
      const boundary = buffer.indexOf('\n');
      if (boundary < 0) return;
      accepted = true;
      let request: unknown;
      try { request = JSON.parse(buffer.slice(0, boundary)); } catch { socket.destroy(); return; }
      buffer = '';
      if (!isRecord(request) || request.token !== token || typeof request.prompt !== 'string' || request.prompt.length > 16_384 || signal.aborted) { socket.destroy(); return; }
      const prompt = request.prompt;
      const challenge = new AbortController();
      const onClose = () => challenge.abort();
      socket.once('close', onClose);
      void (async () => {
        try {
          const answer = await cancellable(options.answer(prompt, AbortSignal.any([signal, challenge.signal])), AbortSignal.any([signal, challenge.signal]));
          if (disposed || socket.destroyed || signal.aborted || typeof answer !== 'string' || !answer || Buffer.byteLength(answer) > 1023 || /[\r\n\0]/.test(answer)) { socket.destroy(); return; }
          socket.end(`${JSON.stringify({ answer })}\n`);
        } catch { socket.destroy(); }
        finally { socket.off('close', onClose); challenge.abort(); }
      })();
    });
  });
  const close = async () => {
    if (disposed) return;
    disposed = true;
    lifetime.abort();
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    await new Promise<void>((resolve) => { if (!server.listening) resolve(); else server.close(() => resolve()); });
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  };
  const onAbort = () => { lifetime.abort(); for (const socket of sockets) socket.destroy(); };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    await chmod(directory, 0o700);
    const helper = join(directory, 'askpass.mjs');
    await writeFile(helper, helperSource, { flag: 'wx', mode: 0o600 });
    const environment: NodeJS.ProcessEnv = { ...(options.env ?? process.env),
      SSH_ASKPASS_REQUIRE: 'force', DISPLAY: options.env?.DISPLAY ?? process.env.DISPLAY ?? 'crosschat',
      CROSSCHAT_ASKPASS_TOKEN: token };
    if (process.platform === 'win32') {
      const executable = join(directory, 'askpass.exe');
      try { await link(process.execPath, executable); } catch { await copyFile(process.execPath, executable); }
      environment.SSH_ASKPASS = executable;
      environment.CROSSCHAT_ASKPASS_EXECUTABLE = executable;
      environment.NODE_OPTIONS = `${environment.NODE_OPTIONS ?? ''} --import=${JSON.stringify(pathToFileURL(helper).href)}`.trim();
    } else {
      const executable = join(directory, 'askpass');
      await writeFile(executable, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(helper)} "$@"\n`, { flag: 'wx', mode: 0o700 });
      environment.SSH_ASKPASS = executable;
      delete environment.CROSSCHAT_ASKPASS_EXECUTABLE;
    }
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once('error', onError);
      server.listen(0, '127.0.0.1', () => { server.off('error', onError); resolve(); });
    });
    server.on('error', () => { lifetime.abort(); for (const socket of sockets) socket.destroy(); });
    const address = server.address();
    if (address === null || typeof address === 'string' || signal.aborted) throw new Error('SSH authentication bridge unavailable.');
    environment.CROSSCHAT_ASKPASS_PORT = String(address.port);
    return { environment, async dispose() { signal.removeEventListener('abort', onAbort); await close(); } };
  } catch (error) {
    signal.removeEventListener('abort', onAbort);
    await close();
    throw error;
  }
}
