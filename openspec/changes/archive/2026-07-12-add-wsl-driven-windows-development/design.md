## Context

LiveDocs already represents WSL workspaces as a distro plus POSIX path, launches the native Windows application through a `livedocs://` URL, and has the Windows process start a versioned workspace agent through `wsl.exe`. The current developer workflow still requires dependencies and builds in separate Windows and WSL checkouts. Its WSL launcher can open an installed Windows app, but it cannot build that app from the WSL checkout.

The Windows shell and WSL agent cannot share one dependency installation. Electron and `better-sqlite3` require Windows/Electron-ABI artifacts for the shell, while the agent requires Linux/Node-ABI artifacts. Building Windows tooling directly against `\\wsl$` also exposes pnpm, Vite, Electron, and file watching to network-style paths, symlink differences, and inconsistent performance.

## Goals / Non-Goals

**Goals:**

- Make a repository stored in WSL the sole developer-managed checkout and source of truth.
- Drive WSL agent build/deployment and Windows shell development, production builds, packaging, and launch from WSL commands.
- Isolate Linux and Windows dependency trees and native artifacts.
- Preserve fast subsequent starts by reusing a deterministic Windows mirror and compatible dependencies.
- Synchronize source changes and deletions accurately enough for the Windows Electron/Vite watch loop.
- Provide predictable cleanup, lifecycle handling, and actionable prerequisite failures.

**Non-Goals:**

- Cross-compiling Windows Electron or native modules under Linux.
- Running the Windows toolchain directly from the WSL filesystem or sharing `node_modules` across operating systems.
- Replacing the installed-app `livedocs .` workflow, the WSLg development path, or the existing WSL agent protocol.
- General-purpose bidirectional file synchronization; edits made in the generated Windows mirror are not preserved.
- Automatically installing Windows Node.js, pnpm, WSL, or native compiler prerequisites.

## Decisions

### Use an NTFS-hosted, disposable Windows build mirror

Each authoritative WSL checkout maps to a stable mirror below a user-local LiveDocs development directory on Windows. Its identity is derived from the WSL distro and canonical POSIX checkout path, with readable metadata recording the source identity and format version. WSL writes the mirror through its mounted Windows filesystem, and Windows tools receive a normal drive-letter path.

The mirror contains synchronized repository build inputs plus Windows-only `node_modules`, build output, and caches. Synchronization owns only the source portion and MUST preserve explicitly excluded Windows-owned paths. The command detects an identity or mirror-format mismatch instead of reusing unrelated contents.

Alternatives considered:

- Building through `\\wsl$`: rejected because Windows native tooling and watchers would operate on a network-style Linux filesystem and still could not share Linux dependencies.
- Requiring a second Git checkout: rejected because it introduces branch, dirty-file, and untracked-file drift and makes the developer coordinate two repositories.
- Copying into a fresh temporary directory for every invocation: rejected because repeated Windows installs and native rebuilds would make the development loop unnecessarily slow.

### Synchronize authoritative WSL files one way

A WSL-side Node orchestrator performs an initial reconciliation and, for development, watches for subsequent additions, changes, and removals. Synchronization is one-way from WSL to Windows. It includes repository source and configuration required by the workspace build while excluding `.git`, all `node_modules`, build/release/test output, coverage, and the mirror's internal metadata. Directory traversal and destination construction validate that writes remain inside the selected mirror.

The initial reconciliation removes stale mirrored source files using a generated manifest rather than deleting arbitrary mirror contents. Incremental events are coalesced and ordered; a deletion removes only a path previously owned by the synchronization manifest. The Windows dev process starts only after initial reconciliation completes.

Git status is not used as the complete synchronization source because builds can depend on tracked files unchanged in the working tree. Git ignore information can supplement explicit exclusions, but the implementation must document how developer-local build inputs such as supported environment files are handled.

Alternatives considered:

- `rsync`: not assumed to exist on Windows and awkward for preserving Windows-owned mirror directories.
- Git archive: omits uncommitted and untracked development work.
- Running two dev servers and serving the renderer across the boundary: rejected because the Electron main/preload bundles and native runtime still require a coherent Windows build and complicate lifecycle management.

### Keep builds native to their execution environment

Before launching the Windows shell, the orchestrator builds the WSL agent with WSL Node/pnpm and installs its shim from the authoritative checkout. It then invokes a Windows-side helper using WSL interop. The helper validates Windows Node and pnpm, installs dependencies in the mirror when needed, and runs the existing desktop development/build/distribution commands under Windows.

Dependency compatibility is represented by a fingerprint over the lockfile, workspace/package manifests, package-manager declaration, relevant build configuration, Windows Node major/ABI, and mirror format. A matching fingerprint permits reuse; a mismatch triggers a Windows install/rebuild before launch. The exact fingerprint inputs should be centralized and tested rather than inferred separately by multiple commands.

The Windows application continues to launch the agent through `wsl.exe` using the original distro and POSIX workspace reference. The agent and shell therefore operate on the same authoritative source revision without routing workspace operations through the mirror.

### Provide one orchestrator with explicit modes

The root exposes WSL-oriented commands for development, production build, installer distribution, launch-only operation, and mirror cleanup. These commands share one orchestration implementation and select a mode instead of duplicating synchronization and prerequisite logic.

- Development performs initial sync, ensures both environment builds, starts continuous sync and Windows `electron-vite` development, and opens the authoritative WSL workspace.
- Build performs a one-shot sync and Windows production build.
- Distribution performs a one-shot sync and Windows installer build.
- Launch-only opens a compatible existing Windows build or installed app without rebuilding and fails clearly when none exists.
- Cleanup removes only a validated LiveDocs-owned mirror for the current checkout, with an option to enumerate or clean stale mirrors separately.

The selected distro defaults to `WSL_DISTRO_NAME`; an explicit override supports diagnostics and multi-distro systems. Paths and arguments cross the WSL/Windows boundary as structured arguments or JSON, not interpolated shell fragments.

### Make process ownership explicit

The WSL orchestrator remains the foreground parent for a development session. It forwards termination, stops its source watcher, requests termination of the Windows helper's process tree, and returns the meaningful child exit code. The Windows helper owns Electron/Vite descendants so it can close them as a group. An unexpected Windows exit ends synchronization; an incremental synchronization failure terminates the session rather than allowing the running UI to silently diverge from WSL source.

The WSL workspace agent remains owned by the Windows application according to the existing backend lifecycle. Installing the agent does not start a second persistent agent from the orchestrator.

### Verify both orchestration and the real boundary

Unit tests cover mirror identity, exclusion rules, manifest reconciliation, path containment, dependency fingerprints, argument construction, and diagnostics. Platform-independent smoke tests use fake Windows helpers. A Windows+WSL integration smoke test runs from a WSL checkout, verifies a source change reaches the Windows mirror and build, launches the Windows shell against the original POSIX workspace, exercises the agent handshake, and confirms cleanup on termination.

## Risks / Trade-offs

- [Large repositories make initial synchronization slow] → Reuse mirrors, reconcile from a manifest, copy only changed file content, and report phase timing.
- [Writing many small files through `/mnt/c` is slower than native Windows copying] → Keep incremental batches small; allow the Windows helper to receive a streamed archive for initial population if measurement shows it is faster without weakening ownership rules.
- [File watcher races leave the mirror inconsistent] → Complete initial reconciliation before watching, buffer events during the handoff, coalesce events, and terminate visibly on unrecoverable sync errors.
- [Ignored local configuration is omitted or secrets are copied] → Define explicit supported local build inputs, default to conservative exclusions, and document the mirror's contents and location.
- [Ctrl+C does not terminate a Windows descendant] → Put descendant ownership in the Windows helper and test normal interruption plus abrupt child exit across WSL interop.
- [Windows dependency cache becomes stale] → Use a versioned dependency fingerprint and provide a clean/rebuild option.
- [Different source revisions build the agent and shell] → Complete the WSL agent build and initial mirror reconciliation in one orchestrated run and record a shared source snapshot identifier in diagnostics.
- [Mirror editing causes lost work] → Mark the mirror as generated, warn when invoked from it, and always define WSL-to-Windows as the only supported direction.

## Migration Plan

1. Add synchronization, identity, fingerprint, and Windows-helper primitives with unit coverage.
2. Add one-shot WSL-driven Windows build and cleanup commands, leaving all existing commands unchanged.
3. Add continuous development synchronization, lifecycle control, and native Windows launch of the original WSL workspace.
4. Add WSL-driven Windows distribution and launch-only modes.
5. Add Windows+WSL integration verification and update developer documentation to present the new workflow as the preferred single-checkout path.
6. Retain the current separate-checkout instructions temporarily as a fallback; rollback consists of removing the new commands and mirrors while continuing to use the existing WSL launcher and Windows build process.

## Open Questions

- Should the default mirror root be `%LOCALAPPDATA%\\LiveDocs\\dev-mirrors` or a developer-configurable location under a broader LiveDocs cache root?
- Which ignored local files, if any, are legitimate Windows shell build inputs and should be included only by explicit configuration?
- Should production artifacts remain inside the mirror, or should completed installers be copied back to a documented WSL-visible output directory?
- Is polling needed as a fallback for any WSL filesystem watcher configurations encountered in supported development environments?
