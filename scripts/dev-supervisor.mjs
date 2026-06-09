/**
 * Dev orchestrator: keeps the API server running and exposes a control endpoint
 * so the Vite proxy can request a restart when it hits ECONNREFUSED.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SUPERVISOR_PORT = Number(process.env.GRIMOIRE_DEV_SUPERVISOR_PORT ?? 3099);
const SERVER_RESTART_DELAY_MS = 2000;
const RESTART_COOLDOWN_MS = 8000;

/** @type {import('node:child_process').ChildProcess | null} */
let serverProcess = null;
/** @type {import('node:child_process').ChildProcess | null} */
let clientProcess = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let scheduledRestart = null;
let shuttingDown = false;
let lastRestartAt = 0;

function log(tag, message) {
  console.log(`[${tag}] ${message}`);
}

function spawnServer() {
  if (shuttingDown) return;

  if (serverProcess) {
    serverProcess.removeAllListeners('exit');
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }

  log('supervisor', 'Starting API server…');
  serverProcess = spawn('pnpm', ['--filter', '@grimoire/server', 'dev'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  serverProcess.on('exit', (code, signal) => {
    serverProcess = null;
    if (shuttingDown) return;

    const reason = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
    log('supervisor', `API server exited (${reason}); restarting in ${SERVER_RESTART_DELAY_MS / 1000}s…`);
    scheduledRestart = setTimeout(() => {
      scheduledRestart = null;
      spawnServer();
    }, SERVER_RESTART_DELAY_MS);
  });
}

function restartServer(trigger = 'manual') {
  const now = Date.now();
  if (now - lastRestartAt < RESTART_COOLDOWN_MS) {
    log('supervisor', `Restart skipped (${trigger}) — cooldown active`);
    return false;
  }
  lastRestartAt = now;

  if (scheduledRestart) {
    clearTimeout(scheduledRestart);
    scheduledRestart = null;
  }

  log('supervisor', `Restarting API server (${trigger})…`);
  spawnServer();
  return true;
}

function spawnClient() {
  log('supervisor', 'Starting Vite client…');
  clientProcess = spawn('pnpm', ['--filter', '@grimoire/client', 'dev'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      FORCE_COLOR: '1',
      GRIMOIRE_DEV_SUPERVISOR_URL: `http://127.0.0.1:${SUPERVISOR_PORT}`,
    },
  });

  clientProcess.on('exit', (code) => {
    clientProcess = null;
    if (!shuttingDown) {
      log('supervisor', `Vite client exited (code ${code ?? 'unknown'})`);
      shutdown(code ?? 0);
    }
  });
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (scheduledRestart) {
    clearTimeout(scheduledRestart);
    scheduledRestart = null;
  }

  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
  if (clientProcess) {
    clientProcess.kill('SIGTERM');
    clientProcess = null;
  }

  controlServer.close(() => process.exit(exitCode));
}

const controlServer = http.createServer((req, res) => {
  const url = req.url ?? '';

  if (req.method === 'POST' && url === '/restart-server') {
    const restarted = restartServer('proxy ECONNREFUSED');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, restarted }));
    return;
  }

  if (req.method === 'GET' && url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404);
  res.end();
});

controlServer.listen(SUPERVISOR_PORT, '127.0.0.1', () => {
  log('supervisor', `Control API listening on http://127.0.0.1:${SUPERVISOR_PORT}`);
  spawnServer();
  spawnClient();
});

controlServer.on('error', (err) => {
  console.error('[supervisor] Control server failed:', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  log('supervisor', 'Shutting down…');
  shutdown(0);
});

process.on('SIGTERM', () => {
  log('supervisor', 'Shutting down…');
  shutdown(0);
});
