/** Native hook entry: relay metadata to the owning window; never send network traffic or stdout context. */
import { createConnection } from 'node:net';
import process from 'node:process';

async function run(): Promise<void> {
  const [, , path, token] = process.argv;
  if (!path || !token) return;
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of process.stdin) {
    const bytes: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length; if (size > 16 * 1024 * 1024) return; chunks.push(bytes);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (typeof value !== 'object' || value === null) return;
  const input = Object.fromEntries(['session_id', 'hook_event_name', 'source', 'reason', 'session_title'].flatMap((key) => {
    const field: unknown = key in value ? value[key as keyof typeof value] : undefined;
    return typeof field === 'string' && field.length <= 4096 ? [[key, field]] : [];
  }));
  await new Promise<void>((resolve) => {
    const socket = createConnection(path, () => socket.end(JSON.stringify({ token, input }) + '\n'));
    const timer = setTimeout(() => socket.destroy(), 500);
    socket.on('error', () => socket.destroy());
    socket.once('close', () => { clearTimeout(timer); resolve(); });
  });
}
void run().catch(() => { /* Hooks are advisory and cannot block native conversation startup. */ });
