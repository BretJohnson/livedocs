import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// Workspace packages are consumed as TypeScript source and must be bundled,
// not externalized; their runtime deps (better-sqlite3, simple-git, ...) are
// also direct deps of this app so externalization resolves them at runtime.
const bundledWorkspacePackages = [
  '@livedocs/store',
  '@livedocs/analysis',
  '@livedocs/generators',
  '@livedocs/ai',
  '@livedocs/pipeline',
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: bundledWorkspacePackages })],
    // The main bundle is ESM ("type": "module") but electron-vite's
    // ?modulePath helper emits __dirname; map it to the ESM equivalent.
    define: { __dirname: 'import.meta.dirname' },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: bundledWorkspacePackages })],
    build: {
      rollupOptions: {
        // Sandboxed preload scripts must be CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    plugins: [react()],
  },
});
