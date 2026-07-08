// Dev launcher. On WSL, Chromium's seccomp sandbox is initialized during
// Electron's early bootstrap — before app code runs — so a runtime
// `appendSwitch('no-sandbox')` is too late and the renderer traps on
// shared-memory syscalls (exit 133 → blank window). ELECTRON_DISABLE_SANDBOX
// is read early enough to actually disable it, but it must be present in the
// environment before Electron launches, which is what this launcher ensures.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

function isWSL() {
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    return /microsoft|wsl/i.test(readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

const env = { ...process.env };
if (process.platform === 'linux' && isWSL() && !env.ELECTRON_DISABLE_SANDBOX) {
  env.ELECTRON_DISABLE_SANDBOX = '1';
  console.log('[livedocs] WSL detected — setting ELECTRON_DISABLE_SANDBOX=1 for dev');
}

const child = spawn('electron-vite', ['dev', '--watch'], {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
