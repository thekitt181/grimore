/**
 * Free dev ports without Get-NetTCPConnection (can hang on some Windows setups).
 */
import { execSync } from 'node:child_process';

const PORTS = [3001, 5173, 3099];

function pidsOnPort(port) {
  if (process.platform === 'win32') {
    try {
      const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        if (!line.includes('LISTENING')) continue;
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (Number.isFinite(pid) && pid > 0) pids.add(pid);
      }
      return [...pids];
    } catch {
      return [];
    }
  }
  try {
    execSync(`lsof -ti:${port}`, { encoding: 'utf8' })
      .split(/\s+/)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

function killPid(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
    } else {
      execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
    }
  } catch {
    /* best effort */
  }
}

for (const port of PORTS) {
  for (const pid of pidsOnPort(port)) {
    killPid(pid);
  }
}
