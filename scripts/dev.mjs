import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';

const server = await createServer();
await server.listen();
server.printUrls();
const env = { ...process.env, MARIONET_DEV_URL: 'http://127.0.0.1:5174' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env, windowsHide: true });
let closing = false;
async function stop(code = 0) {
  if (closing) return;
  closing = true;
  if (child.exitCode === null) child.kill();
  await server.close(); process.exit(code);
}
child.on('exit', code => void stop(code ?? 0));
child.on('error', () => void stop(1));
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());

