import { spawn } from 'node:child_process';

// Keep delayed notifications running even when nobody has the website open.
// PostgreSQL row locks let the HTTP handlers and this worker share the outbox.
const children = [spawn('pnpm', ['start'], { stdio: 'inherit' }), spawn('pnpm', ['worker'], { stdio: 'inherit' })];
let stopping = false;
function stop(code, signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
  const deadline = setTimeout(() => { for (const child of children) child.kill('SIGKILL'); process.exit(code); }, 8000);
  deadline.unref();
  Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve)))).then(() => process.exit(code));
}
for (const child of children) {
  child.on('error', () => stop(1));
  child.on('exit', code => { if (!stopping) stop(code || 1); });
}
process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0, 'SIGINT'));
