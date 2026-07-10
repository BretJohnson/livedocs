import { BrowserWindow, app } from 'electron';
import path from 'node:path';
import { findWslLaunchUrl, parseWslLaunchUrl } from '@livedocs/store';
import { openWorkspaceRequest } from './workspace-router';

export function installLaunchBridge(): boolean {
  const lock = app.requestSingleInstanceLock();
  if (!lock) {
    app.quit();
    return false;
  }

  registerProtocolClient();

  app.on('second-instance', (_event, argv) => {
    focusExistingWindow();
    void openFromArgv(argv);
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    focusExistingWindow();
    void openLaunchUrl(url);
  });
  return true;
}

export async function openFromArgv(argv: readonly string[]): Promise<boolean> {
  const url = findWslLaunchUrl(argv);
  return url ? openLaunchUrl(url) : false;
}

export async function openLaunchUrl(url: string): Promise<boolean> {
  const reference = parseWslLaunchUrl(url);
  if (!reference) return false;
  try {
    await openWorkspaceRequest({ reference });
    focusExistingWindow();
    return true;
  } catch (err) {
    console.error('[livedocs] failed to open launch URL', err);
    return false;
  }
}

function registerProtocolClient(): void {
  if (process.platform !== 'win32') return;
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient('livedocs', process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient('livedocs');
  }
}

function focusExistingWindow(): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.focus();
}
