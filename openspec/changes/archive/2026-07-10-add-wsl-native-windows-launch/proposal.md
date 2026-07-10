## Why

LiveDocs should support the most ergonomic Windows + WSL workflow: keep repositories, build tools, Git, file watching, and indexing inside WSL while presenting the app as a native Windows desktop application. The current WSLg Electron path works for development, but it gives users a Linux GUI app experience and forces the desktop shell and workspace engine to share one OS boundary.

## What Changes

- Add a Windows-native LiveDocs client mode that can open WSL-hosted workspaces without reading them through `\\wsl$`.
- Add a WSL workspace agent that owns repository IO, watching, Git, SQLite-backed indexes/caches, generators, and AI context gathering for WSL workspaces.
- Add a WSL launcher command so `livedocs .` inside WSL opens or focuses the native Windows app with the requested distro and path.
- Add a Windows deep-link or equivalent launch bridge for published installs so the WSL launcher can invoke the installed Windows app reliably.
- Add development scripts for building/running the workspace agent in WSL while launching the Windows Electron app for native UI testing.
- Preserve the existing local single-process Electron path for non-WSL local folders and current automated tests until the remote path is fully covered.

## Capabilities

### New Capabilities
- `wsl-native-windows-launch`: Native Windows app launching, WSL launcher integration, and WSL workspace agent connection behavior.

### Modified Capabilities
- `workspace-management`: Workspace opening, recent workspaces, path identity, file browsing, and file-change handling must distinguish local Windows workspaces from WSL-backed workspaces.
- `repository-analysis`: Repository indexing, Git integration, dependency analysis, and search must be able to run in the WSL workspace agent and return results to the Windows client.

## Impact

- Desktop app main process, preload IPC contract, renderer workspace-opening flows, recent workspace storage, and development launch scripts.
- New shared protocol types and a WSL agent/CLI package or app entrypoint.
- Windows packaging configuration for installer/deep-link registration and a small WSL-side launcher package or install script.
- Native module handling for `better-sqlite3`: WSL agent uses Linux/Node-compatible binaries; Windows Electron client uses Windows/Electron-compatible binaries only where needed.
- Test coverage for protocol behavior, WSL path/distro serialization, agent lifecycle, existing local workspace behavior, and at least one scripted dev-launch path.
