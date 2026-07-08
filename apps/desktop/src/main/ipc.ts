import { BrowserWindow, ipcMain } from 'electron';
import type { EventChannel, EventMap, InvokeChannel, InvokeMap } from '../shared/ipc';

/** Typed wrapper over ipcMain.handle. */
export function handle<C extends InvokeChannel>(
  channel: C,
  handler: (payload: InvokeMap[C]['req']) => Promise<InvokeMap[C]['res']> | InvokeMap[C]['res'],
): void {
  ipcMain.handle(channel, (_event, payload) => handler(payload));
}

/** Typed broadcast to all renderer windows. */
export function broadcast<C extends EventChannel>(channel: C, data: EventMap[C]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, data);
  }
}
