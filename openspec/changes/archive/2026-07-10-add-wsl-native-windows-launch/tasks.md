## 1. Shared Workspace Model And Protocol

- [x] 1.1 Add shared workspace reference types for local and WSL workspaces, including stable display labels and serialization helpers.
- [x] 1.2 Add a workspace backend interface that covers the current main-process workspace operations and events.
- [x] 1.3 Adapt the existing local workspace/session implementation to the workspace backend interface without changing current local behavior.
- [x] 1.4 Define versioned agent protocol request, response, error, and event types for workspace, file, search, Git, index, generation, and AI operations.
- [x] 1.5 Add unit tests for workspace reference serialization, WSL path identity, display labels, and protocol version handshake behavior.

## 2. WSL Workspace Agent

- [x] 2.1 Extract reusable workspace service logic from the Electron main process so it can run outside Electron inside a Node-based agent.
- [x] 2.2 Add a WSL agent entrypoint that accepts a workspace reference, opens the workspace, and serves the shared protocol over stdio.
- [x] 2.3 Implement agent handlers for workspace tree, file read, accepted edit, search, Git overview/history, index status, generated artifact get/refresh, and AI actions.
- [x] 2.4 Forward file-change, index-status, workspace-change, and generation-staleness events from the agent to the protocol client.
- [x] 2.5 Ensure WSL agent data directories and `better-sqlite3` loading stay inside WSL and use Linux/Node-compatible dependencies.
- [x] 2.6 Add agent lifecycle tests for clean shutdown, unexpected exit, and path traversal rejection.

## 3. Windows Client Integration

- [x] 3.1 Add a protocol client in the Electron main process that can launch `wsl.exe -d <distro> -- <agent-command>` and communicate with the agent over stdio.
- [x] 3.2 Add backend routing so local workspace references use the local backend and WSL workspace references use the agent backend.
- [x] 3.3 Update IPC handlers and renderer-facing types to accept explicit workspace references while preserving the existing open-dialog flow.
- [x] 3.4 Update recent workspace storage and UI rendering to preserve and display WSL workspace kind, distro, POSIX path, name, and last-opened time.
- [x] 3.5 Surface WSL agent connection, compatibility, and disconnection errors in the renderer without losing the existing local workspace experience.

## 4. Launch Bridge And WSL Launcher

- [x] 4.1 Add Windows app launch handling for WSL workspace requests, including parsing the requested distro/path and forwarding requests to the running instance.
- [x] 4.2 Register a Windows launch mechanism for installed apps, preferably a custom protocol for WSL workspace open requests.
- [x] 4.3 Add a WSL-side `livedocs` launcher that detects the current distro, resolves POSIX paths, encodes the launch request, and invokes the Windows app through WSL interop.
- [x] 4.4 Make the WSL launcher report actionable errors when the Windows app or compatible agent command is unavailable.
- [x] 4.5 Add tests for launch request parsing, second-instance forwarding, distro/path encoding, and missing-install diagnostics.

## 5. Development Workflow

- [x] 5.1 Add dev scripts for starting the WSL agent from WSL and launching a native Windows Electron UI connected to it.
- [x] 5.2 Keep the existing WSLg `pnpm dev` path working and documented as the Linux Electron fallback.
- [x] 5.3 Document the two-environment dependency model, including separate Windows and WSL installs for platform-specific Electron and native modules.
- [x] 5.4 Add a scripted smoke check for the native-Windows-from-WSL dev path using a sample workspace or mocked agent when WSL automation is unavailable.

## 6. Packaging And Install

- [x] 6.1 Add Windows packaging configuration for the native app, including the launch/deep-link registration required by the WSL launcher.
- [x] 6.2 Add a WSL launcher packaging or install path, such as an npm package or shell installer, that can be used independently of the Windows installer.
- [x] 6.3 Add release/build documentation that recommends producing Windows installers on Windows CI to avoid cross-platform native module issues.
- [ ] 6.4 Verify the published Windows app can be launched from WSL, can reuse an existing app instance, and can open a WSL workspace through the agent.

## 7. Regression And Validation

- [x] 7.1 Add backend contract tests that run against the local backend and a test agent backend for the same workspace operations.
- [x] 7.2 Add regression coverage proving local folder open, local recents, local indexing, and existing e2e smoke behavior still work.
- [x] 7.3 Add WSL-backed workspace tests for file browsing, document rendering, accepted edit application, watcher updates, search, Git overview, and Git file history.
- [x] 7.4 Run `pnpm typecheck`, `pnpm test`, and the relevant desktop e2e suite after implementation.
- [x] 7.5 Update README or developer docs with native Windows UI from WSL usage, published install usage, troubleshooting, and known limitations.
