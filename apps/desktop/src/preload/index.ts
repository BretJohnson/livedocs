import { contextBridge, ipcRenderer } from 'electron';
import {
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  type EventChannel,
  type InvokeChannel,
  type LiveDocsBridge,
} from '../shared/ipc';

const invokeChannels = new Set<string>(INVOKE_CHANNELS);
const eventChannels = new Set<string>(EVENT_CHANNELS);

const bridge: LiveDocsBridge = {
  invoke: (channel: InvokeChannel, payload: unknown) => {
    if (!invokeChannels.has(channel)) {
      return Promise.reject(new Error(`Unknown IPC channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, payload);
  },
  on: (channel: EventChannel, listener: (data: never) => void) => {
    if (!eventChannels.has(channel)) {
      throw new Error(`Unknown IPC event channel: ${channel}`);
    }
    const wrapped = (_event: unknown, data: never) => listener(data);
    ipcRenderer.on(channel, wrapped as never);
    return () => ipcRenderer.removeListener(channel, wrapped as never);
  },
};

contextBridge.exposeInMainWorld('livedocs', bridge);
