import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PosixPipeTransport,
  WindowsNamedPipeTransport,
} from '../src/platform/pipe-transport.js';

const testPipe = () => `\\\\.\\pipe\\LOCAL\\multichat-test-${randomBytes(8).toString('hex')}`;

const servers: import('node:net').Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

function listen(server: import('node:net').Server, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => resolve());
  });
}

describe.skipIf(process.platform !== 'win32')('WindowsNamedPipeTransport', () => {
  it('delivers auth + frame lines to a mock pipe server', async () => {
    const path = testPipe();
    const server = createServer();
    servers.push(server);
    const received: string[] = [];
    let serverSawEnd: () => void;
    const serverSawEndPromise = new Promise<void>((resolve) => {
      serverSawEnd = resolve;
    });
    server.on('connection', (socket) => {
      let buffer = '';
      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
      });
      socket.on('end', () => {
        received.push(...buffer.split('\n').filter((line) => line !== ''));
        socket.end();
        serverSawEnd();
      });
    });
    await listen(server, path);

    const authLine = JSON.stringify({ type: 'auth', token: 'tok' });
    const frameLine = JSON.stringify({
      msgV: 1,
      msg_id: 'u',
      type: 'user',
      message: { role: 'user', content: 'hi' },
      priority: 'next',
    });
    await new WindowsNamedPipeTransport().sendLines(path, [authLine, frameLine]);
    await serverSawEndPromise;

    expect(received).toEqual([authLine, frameLine]);
  });

  it('reports PIPE_CONNECT_FAILED for a pipe nobody listens on', async () => {
    await expect(
      new WindowsNamedPipeTransport().sendLines(testPipe(), ['{"type":"auth"}']),
    ).rejects.toMatchObject({ code: 'PIPE_CONNECT_FAILED' });
  });

  it('reports PIPE_WRITE_UNCERTAIN when the server cuts the connection mid-write', async () => {
    const path = testPipe();
    const server = createServer((socket) => {
      // Stop reading so the client's bulk write stalls in the pipe, then
      // break the pipe mid-write.
      socket.pause();
      setTimeout(() => socket.destroy(), 300);
    });
    servers.push(server);
    await listen(server, path);

    const bigFrame = `{"padding":"${'x'.repeat(512 * 1024)}"}`;
    await expect(
      new WindowsNamedPipeTransport().sendLines(path, [bigFrame, '{"type":"user"}']),
    ).rejects.toMatchObject({ code: 'PIPE_WRITE_UNCERTAIN' });
  });
});

describe('PosixPipeTransport', () => {
  it('rejects with NOT_IMPLEMENTED', async () => {
    await expect(new PosixPipeTransport().sendLines('/tmp/x.sock', ['a'])).rejects.toMatchObject(
      { code: 'NOT_IMPLEMENTED' },
    );
  });
});
