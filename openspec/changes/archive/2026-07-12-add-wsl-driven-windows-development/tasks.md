## 1. Cross-Environment Foundations

- [x] 1.1 Add a shared WSL-driven Windows orchestration module with explicit `dev`, `build`, `dist`, `launch`, and `clean` modes and reject execution outside WSL with an actionable diagnostic.
- [x] 1.2 Implement Windows prerequisite discovery through WSL interop for `powershell.exe`, Windows Node.js, the repo-pinned pnpm version, and required build tools, preserving structured arguments without shell interpolation.
- [x] 1.3 Define the configurable Windows mirror root, derive a stable mirror identity from the canonical distro and POSIX checkout path, and persist versioned ownership metadata in each mirror.
- [x] 1.4 Implement path-containment and ownership checks so synchronization and cleanup cannot write or delete outside a validated LiveDocs mirror.
- [x] 1.5 Add unit tests for WSL detection, distro/path canonicalization, mirror identity stability, Windows-path conversion, prerequisite diagnostics, and hostile path or argument inputs.

## 2. Authoritative Source Synchronization

- [x] 2.1 Define and document synchronized build inputs and explicit exclusions for repository metadata, dependencies, build/release/test output, coverage, and mirror metadata, including the policy for supported local environment files.
- [x] 2.2 Implement initial one-way reconciliation from the WSL checkout to the Windows mirror with a source-owned manifest, changed-content copying, stale-file removal, and preservation of Windows-owned dependency and output paths.
- [x] 2.3 Implement continuous WSL source watching for development mode with buffered handoff after initial reconciliation, event batching, additions, changes, removals, and directory changes.
- [x] 2.4 Make synchronization failures terminate the development session with clear source and destination diagnostics instead of leaving the Windows shell on stale source.
- [x] 2.5 Add unit and integration tests for exclusions, local-file policy, initial and repeated reconciliation, stale source deletion, Windows-owned path preservation, path traversal rejection, and incremental event ordering.

## 3. Native Dependency and Agent Preparation

- [x] 3.1 Centralize a Windows dependency fingerprint covering the lockfile, package/workspace manifests, package-manager version, relevant build configuration, Windows Node ABI, and mirror format.
- [x] 3.2 Add Windows-side helper behavior that validates mirror ownership, runs the repo-pinned Windows pnpm install/rebuild when the fingerprint is absent or incompatible, and reuses compatible dependencies otherwise.
- [x] 3.3 Integrate the existing WSL build and `install:wsl-launcher` behavior so development sessions build and install a Linux/Node-ABI agent from the authoritative checkout before starting the Windows shell.
- [x] 3.4 Record and report a shared source snapshot identifier for the prepared WSL agent and synchronized Windows shell inputs so version drift is diagnosable.
- [x] 3.5 Add tests for dependency fingerprint invalidation, compatible-cache reuse, Linux/Windows dependency isolation, WSL agent preparation failure, and source snapshot reporting.

## 4. Windows Development and Launch Lifecycle

- [x] 4.1 Implement the Windows helper that runs the existing Electron/Vite development command from the drive-letter mirror and owns the resulting Windows process tree.
- [x] 4.2 Have development mode wait for initial synchronization and both environment preparations, then launch the native Windows shell with the authoritative distro and POSIX workspace reference.
- [x] 4.3 Coordinate the WSL synchronizer and Windows helper lifecycle so Ctrl+C, Windows child exit, and synchronization failure terminate session-owned processes and propagate a meaningful exit status.
- [x] 4.4 Implement launch-only mode for a compatible existing development build or installed Windows app, with a clear failure when no launch target is available.
- [x] 4.5 Add process-level tests using a fake Windows helper for argument transport, startup ordering, workspace identity, normal exit, interruption, unexpected child exit, and descendant cleanup.

## 5. Windows Build, Distribution, and Mirror Management

- [x] 5.1 Implement one-shot WSL-driven Windows production build mode using initial synchronization and the Windows mirror without starting continuous watching.
- [x] 5.2 Implement one-shot WSL-driven Windows distribution mode that invokes the configured Windows installer build and reports the artifact location to the WSL terminal.
- [x] 5.3 Decide and implement whether completed Windows build and installer artifacts remain in the mirror or are copied to a documented WSL-visible output location.
- [x] 5.4 Implement current-mirror inspection and cleanup with strict ownership validation, plus an explicit mechanism to enumerate or remove stale LiveDocs mirrors.
- [x] 5.5 Add tests for build/dist command selection, exit propagation, artifact reporting, mirror reuse, incompatible mirror rejection, and safe cleanup.

## 6. Command Surface and Documentation

- [x] 6.1 Add root and desktop package scripts for WSL-driven Windows development, production build, distribution, launch-only, and mirror cleanup while retaining the existing WSLg and installed-app launcher commands.
- [x] 6.2 Update the README and developer setup guide to make the single WSL checkout workflow the preferred native-Windows development path and document Windows prerequisites, mirror location/configuration, command behavior, and first-run cost.
- [x] 6.3 Update the WSL-native Windows guide with dependency isolation, synchronized-file policy, lifecycle behavior, artifact locations, clean/rebuild recovery, multi-distro selection, and troubleshooting diagnostics.
- [x] 6.4 Ensure generated Windows mirrors are recognizable as disposable, warn developers not to edit them, and document that synchronization is strictly WSL-to-Windows.

## 7. End-to-End Verification

- [x] 7.1 Extend platform-independent smoke coverage to exercise orchestration modes and failure diagnostics through fake WSL/Windows boundaries.
- [x] 7.2 Add a real Windows+WSL integration smoke test that starts from a WSL checkout, prepares the Linux agent, synchronizes and builds the Windows shell, and verifies the agent protocol handshake for the original POSIX workspace.
- [x] 7.3 Extend the integration smoke test to verify an added, changed, and removed WSL source file reaches the running Windows development build and that excluded paths never enter the mirror.
- [x] 7.4 Verify Ctrl+C and unexpected Windows-process termination clean up the watcher and Windows process tree without leaving a session-owned agent or build process running.
- [ ] 7.5 Run typecheck, unit tests, existing WSL agent/native smoke checks, the new cross-environment smoke test, a Windows production build, and a Windows installer build; record any environment-specific prerequisites or residual limitations.
