## Why

Developers who keep the LiveDocs repository in WSL must currently maintain a separate Windows checkout and manually coordinate Linux agent and Windows Electron builds. LiveDocs should make WSL the single source-of-truth development environment while treating Windows as an automatically managed build and launch target.

## What Changes

- Add a WSL-side command that synchronizes the authoritative WSL checkout into an isolated Windows build mirror, installs or reuses Windows dependencies there, and starts the native Windows Electron development process.
- Build and install the Linux WSL agent from the authoritative WSL checkout before launching the Windows shell, preserving Linux-native dependencies and the original POSIX workspace identity.
- Add WSL-driven commands for one-shot Windows production builds and Windows installer builds in addition to the continuous development workflow.
- Incrementally synchronize relevant source changes to the Windows mirror so the Windows Electron/Vite development loop can reload without sharing `node_modules` across operating systems.
- Define lifecycle, diagnostics, distro selection, mirror cleanup, dependency invalidation, and verification behavior for the cross-environment workflow.
- Keep the existing WSLg development path and installed-app `livedocs://` launcher behavior available.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `wsl-native-windows-launch`: Expand native Windows UI development from WSL source into a complete WSL-driven workflow that builds, synchronizes, launches, packages, and verifies the Windows shell without requiring a user-managed Windows checkout.

## Impact

- Affects root and desktop package scripts, WSL-side orchestration and source synchronization scripts, Windows process launch, WSL agent installation, development documentation, and smoke/integration coverage.
- Introduces a disposable Windows-side source mirror and dependency cache under a user-local build-data directory; the WSL repository remains authoritative and its Linux `node_modules` remains isolated.
- Requires Windows Node.js/pnpm and WSL interoperability for Windows-shell builds, while retaining the existing Linux-only WSLg workflow.
- Does not change the agent protocol or WSL workspace identity model, but must ensure the Windows shell and WSL agent are built from the same source revision.
