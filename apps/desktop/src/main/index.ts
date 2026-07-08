import { BrowserWindow, app, session, shell } from 'electron';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { registerHandlers } from './handlers';
import { getSession, openWorkspace } from './session';

// Test isolation: e2e runs point user data at a throwaway directory.
if (process.env.LIVEDOCS_USER_DATA) {
  app.setPath('userData', process.env.LIVEDOCS_USER_DATA);
}

/**
 * Detect WSL robustly (WSL_DISTRO_NAME isn't always exported, so also read
 * /proc/version). On WSL the sandbox must be disabled via the
 * ELECTRON_DISABLE_SANDBOX env var *before* Electron boots — see
 * scripts/dev.mjs — because Chromium's seccomp sandbox initializes before app
 * code runs and blocks shared-memory syscalls (renderer traps, exit 133). The
 * runtime --no-sandbox switch below is too late for that, but it still covers
 * non-WSL Linux/containers that lack a working SUID sandbox helper.
 */
function isWSL(): boolean {
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) return true;
  try {
    return /microsoft|wsl/i.test(readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

if (process.platform === 'linux' && (process.env.LIVEDOCS_NO_SANDBOX || isWSL())) {
  app.commandLine.appendSwitch('no-sandbox');
  app.disableHardwareAcceleration();
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    title: 'LiveDocs',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // External targets never open inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Surface renderer failures (crashes, load/preload errors) in the terminal so
  // a blank window is diagnosable without DevTools. Routine console output is
  // only forwarded when LIVEDOCS_DEBUG is set, to keep the dev log clean.
  if (process.env.LIVEDOCS_DEBUG) {
    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    });
  }
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[renderer] did-fail-load ${code} ${desc} ${url}`);
  });
  win.webContents.on('preload-error', (_e, preloadPath, error) => {
    console.error(`[renderer] preload-error ${preloadPath}:`, error);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] render-process-gone:', details);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
    if (process.env.LIVEDOCS_DEVTOOLS === '1') {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    void win.loadFile(path.join(import.meta.dirname, '../renderer/index.html'));
  }
  return win;
}

/**
 * Content-Security-Policy is served from here rather than a static <meta> so it
 * can differ by mode. In dev the Vite server + @vitejs/plugin-react inject an
 * inline Fast-Refresh preamble and use eval/websockets for HMR, which a strict
 * policy would block (blanking the window). Production is locked down; Shiki's
 * WASM needs 'wasm-unsafe-eval'.
 */
function installCsp(): void {
  const dev = Boolean(process.env.ELECTRON_RENDERER_URL);
  const policy = dev
    ? [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "connect-src 'self' ws: http://localhost:*",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "worker-src 'self' blob:",
      ].join('; ')
    : [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "worker-src 'self' blob:",
      ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });
}

app.whenReady().then(async () => {
  installCsp();
  registerHandlers();
  const win = createWindow();
  win.webContents.once('did-finish-load', () => {
    console.log('[livedocs] window ready');
  });

  // E2E / scripted launches can preopen a workspace.
  const preopen = process.env.LIVEDOCS_WORKSPACE;
  if (preopen) {
    try {
      await openWorkspace(preopen);
    } catch (err) {
      console.error('[livedocs] failed to preopen workspace', err);
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  getSession()?.dispose();
  if (process.platform !== 'darwin') app.quit();
});
