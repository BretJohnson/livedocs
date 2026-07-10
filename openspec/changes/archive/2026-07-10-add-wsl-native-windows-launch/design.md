## Context

LiveDocs is currently an Electron desktop app with a React renderer, an Electron main process, and reusable TypeScript packages for storage, repository analysis, generation, markdown rendering, and AI. Development under WSL works today by launching Linux Electron through WSLg with sandbox workarounds, but that makes the app feel like a WSL GUI app and keeps desktop UI concerns coupled to Linux-side workspace IO.

The desired model is closer to VS Code Remote WSL: source and build tools stay in the WSL filesystem, while the user interacts with a native Windows app. For LiveDocs, that means repository-sensitive work must run inside WSL and the Windows app must avoid treating WSL paths as Windows UNC paths for indexing, watching, Git, or SQLite-backed workspace state.

## Goals / Non-Goals

**Goals:**

- Run the LiveDocs desktop UI as a native Windows Electron app when opening WSL-hosted workspaces.
- Keep workspace IO, file watching, Git commands, indexing, generator input gathering, and workspace SQLite state inside the selected WSL distro.
- Provide a WSL command such as `livedocs .` that launches or focuses the installed Windows app with the requested distro/path.
- Support a development flow where source/build/watch commands run from WSL and the Windows Electron app is launched for native UI testing.
- Preserve the existing local single-process path for ordinary Windows, Linux, and test workspaces while the WSL remote path matures.

**Non-Goals:**

- Replacing Electron or rewriting the renderer.
- Running Windows tooling against WSL source through `\\wsl$` for analysis or watching.
- Supporting arbitrary remote SSH/container workspaces in this change, beyond designing the boundary so future remotes are plausible.
- Shipping a full auto-update/signing pipeline beyond the packaging hooks needed for install and launch integration.

## Decisions

### Use a WSL workspace agent as the owner of repository behavior

LiveDocs will introduce a WSL-side agent process that runs under Node in the selected distro. The agent owns workspace sessions, file reads/writes, tree building, watchers, Git, repository indexing, generator execution, AI context gathering, and per-workspace SQLite stores for WSL workspaces.

The Windows Electron main process becomes a client for WSL-backed workspaces. Renderer IPC remains typed, but the main process routes workspace operations either to the existing local implementation or to the WSL agent through a shared workspace backend interface.

Alternatives considered:

- Let Windows Electron read `\\wsl$` paths directly. This is simpler initially, but file watching, path identity, Git behavior, case sensitivity, and performance are fragile for repository-scale IO.
- Run the whole Electron app under WSLg. This already works for development, but it does not provide the desired native Windows app experience.
- Move only Git to WSL while keeping file IO on Windows. This creates split-brain path and freshness behavior; the agent boundary is cleaner.

### Share workspace service behavior with environment-specific adapters

Local and WSL-backed workspaces should use the same core workspace service for repository IO, safe file resolution, accepted edits, file watching, index refresh orchestration, generated-artifact staleness, Git metadata refresh, tree building, and search. Environment-specific behavior is injected around that core instead of duplicated in separate local and agent implementations.

The local Electron path injects a worker-thread indexer driver so repository scans continue to run off the main process, and it injects Electron-facing event broadcasts plus local AI provider access. The WSL agent path uses the same service with a direct Node indexer driver, protocol event serialization, and no local Electron AI provider. Electron shell behavior such as opening external URLs remains in the local backend adapter rather than the shared service.

Alternatives considered:

- Keep separate local session and WSL service implementations. This preserved the initial extraction shape but caused drift in read/edit behavior, watcher-to-index updates, generated artifact staleness, and Git refresh behavior.
- Route local workspaces through the WSL-oriented service without strategies. This would reduce duplication, but it would regress local responsiveness by replacing the worker-thread indexer with in-process indexing and would entangle Electron-only AI behavior with the agent-capable service.
- Extract only the duplicated file read/edit helpers. That would address the smallest repeated code block while leaving the watcher, index, staleness, Git, search, and artifact pipeline duplicated.

### Communicate over a narrow JSON-RPC-style protocol

The Windows app and WSL agent will communicate through a versioned request/event protocol shared by both sides. Initial transport should prefer stdio when the Windows app launches the agent via `wsl.exe -d <distro> -- <agent-command>`, with a localhost WebSocket transport allowed for dev server workflows if useful.

The protocol should model the existing IPC surface: workspace open/current/recents/tree, file read/apply edit, search, Git overview/history, index status/events, generated artifact get/refresh, AI config/actions, and cancellation. Agent events carry workspace changes, index status changes, and generated-content staleness notifications back to the Windows client.

Alternatives considered:

- Use HTTP only. It is inspectable, but lifecycle, auth token handling, and port collision management are more complex for a per-workspace local process.
- Reuse Electron IPC directly. Electron IPC does not cross the Windows/WSL process boundary.
- Shell out per operation. This avoids a daemon but is too slow for indexing, watching, streaming AI, and event delivery.

### Represent WSL workspaces explicitly

Workspace identity will distinguish local paths from WSL paths. A WSL workspace reference includes at least `kind: "wsl"`, `distro`, and a POSIX `path`; local workspaces retain native absolute paths. Recents, workspace database naming, display labels, and launch arguments must preserve this identity instead of collapsing WSL paths into Windows UNC strings.

The UI should present WSL workspaces clearly, for example with a label like `Ubuntu:/home/bret/src/livedocs`, while preserving familiar file-tree relative paths inside the workspace.

Alternatives considered:

- Store only the resolved Windows UNC path. This loses distro/path semantics and encourages Windows-side repository IO.
- Store opaque deep-link URLs everywhere. URLs are useful at the launch boundary, but typed workspace references are easier to validate and test internally.

### Scope Git integration to the opened workspace inside larger worktrees

LiveDocs should keep Git features available when the opened workspace is a subdirectory of a larger Git worktree. Branch metadata comes from the containing worktree, while recent commits, file history, and AI recent-change diffs are scoped to the opened workspace path so unrelated parent-repository changes do not appear in the workspace experience.

Commit file paths returned to the UI should be workspace-relative where possible. This preserves the existing local expectation that opening a monorepo package still has Git history, while avoiding parent-repository leakage for both local and WSL-backed workspaces.

Alternatives considered:

- Require the opened workspace path to equal the Git worktree root. This avoids parent-repository leakage but disables Git unexpectedly for common monorepo subfolder workflows.
- Show parent worktree Git history without scoping. This preserves branch data, but recent commits and AI summaries become noisy when unrelated packages change.

### Add a Windows launch bridge and WSL launcher

The published Windows app will register a launch mechanism suitable for external invocation, preferably a custom protocol such as `livedocs://wsl/open?...` plus Electron single-instance handling. The WSL launcher command serializes the current distro and POSIX path, invokes the Windows registered launch target through WSL interop, and returns promptly once the Windows app accepts the request.

For development, scripts should support launching the Windows Electron binary from WSL and connecting it to a WSL-built renderer/agent. The dev command may require Windows Node dependencies to be installed separately from WSL dependencies because native modules and Electron binaries are platform-specific.

Alternatives considered:

- Require users to open the Windows app and browse to the WSL workspace manually. This misses the VS Code-like `livedocs .` workflow.
- Have the WSL launcher run a WSL GUI app. That reproduces the current UI problem.
- Bundle the WSL agent inside the Windows installer only. The agent must execute inside WSL with Linux-compatible dependencies, so it should be installed or bootstrapped on the WSL side.

### Keep native dependencies platform-local

`better-sqlite3` must remain ABI/platform local. The WSL agent should use Linux/Node-compatible native modules installed in WSL. The Windows Electron app should only load Windows/Electron-compatible native modules for local Windows workspaces. Build scripts and package boundaries should avoid making one OS load the other's `node_modules`.

Alternatives considered:

- Share one workspace `node_modules` tree between Windows and WSL. This is not reliable for Electron, Node, and native module ABIs.
- Remove SQLite native storage in the WSL path. That would degrade the existing indexing/cache model and is unnecessary if the agent owns storage.

## Risks / Trade-offs

- Agent lifecycle bugs could leave stale WSL processes running -> launch agents as child processes where possible, add heartbeat/shutdown handling, and expose debug logs.
- Protocol drift could break the renderer in subtle ways -> define shared request/event types, version the handshake, and test local and WSL backend adapters against the same contract.
- Two runtime environments increase install complexity -> document separate Windows app and WSL launcher installs, and make the launcher diagnose missing Windows app or missing WSL agent dependencies.
- Dev setup may require both Windows and WSL dependency installs -> make this explicit in scripts and README rather than pretending one install can serve both native environments.
- Stdio transport can be harder to inspect than HTTP -> provide optional verbose logging and allow a dev WebSocket transport for troubleshooting.

## Migration Plan

1. Introduce shared workspace reference and backend abstractions while keeping the current local backend behavior unchanged.
2. Extract the current session/repository logic into an agent-capable service entrypoint that can run in-process for local workspaces and out-of-process in WSL.
3. Add the protocol client/server and tests around request/response/event behavior.
4. Add the WSL launcher and Windows launch/deep-link handling.
5. Add dev scripts and documentation for WSL source/build with native Windows UI launch.
6. Add Windows packaging metadata for published install integration.

Rollback is straightforward until the new path is made default: keep the existing `pnpm dev` and local workspace backend as the stable path, and gate WSL-native launching behind new commands/launch arguments.

## Open Questions

- Should the initial dev transport be stdio-only, or should a WebSocket dev mode be added at the same time for easier inspection?
- Should the WSL launcher be published as an npm package, installed by a shell script, or both?
- Which installer target should be the first supported Windows package format: NSIS, MSI, or another existing Electron packaging convention?
