import type { EventChannel, EventMap, LiveDocsBridge } from '../../shared/ipc';
import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    livedocs: LiveDocsBridge;
  }
}

export const api: LiveDocsBridge = window.livedocs;

/** Subscribe to a main-process event for the lifetime of the component. */
export function useEvent<C extends EventChannel>(
  channel: C,
  handler: (data: EventMap[C]) => void,
): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => api.on(channel, (data) => ref.current(data)), [channel]);
}
