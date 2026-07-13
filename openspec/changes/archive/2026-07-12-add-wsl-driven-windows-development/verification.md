## Verification record

Run on Windows with an Ubuntu WSL distro on 2026-07-12:

- `pnpm typecheck`: passed across all workspace projects.
- Full Vitest suite after review fixes: 101 tests passed across 11 files, including 18
  orchestration, mirror, dependency-cache, and process-lifecycle tests.
- Targeted ESLint and Prettier checks for new scripts, tests, commands, and docs: passed.
- `pnpm smoke:wsl-native`, `pnpm smoke:wsl-agent`, and
  `pnpm smoke:wsl-windows`: passed.
- Existing Windows `pnpm build`: passed.
- A real Ubuntu WSL to Windows Node lifecycle smoke passed with the production control
  pipe and Windows helper. Both an interrupt and an unexpected Windows child exit
  removed the fake build process and its descendant, and interruption returned 130.
- Incremental synchronization now treats transient `ENOENT`/`ENOTDIR` source races as
  nonfatal, reuses source hash metadata, and skips destination rehashing after the full
  initial reconciliation. Tests cover transient collection/copy races and the strong
  initial-versus-fast-incremental behavior.
- Real WSL checkout prerequisite discovery, mirror ownership, initial synchronization,
  Windows path conversion, and native Windows helper startup: passed.
- Real mirror dependency installation remained blocked after resolving 801 packages and
  downloading/reusing 726. Two unrelated long-running Windows pnpm installs were also
  present; a mirror-local store was added to remove shared-store contention, but the
  resolver still stopped making progress. The session-owned process tree and partial
  mirror were removed safely.
- Existing Windows `pnpm dist:win` reached electron-builder packaging and native module
  preparation, then failed to rename `release\win-unpacked.tmp` because the existing
  `release\win-unpacked` target was locked (`EPERM`). No existing process or artifact
  was forcefully removed.

The opt-in `pnpm smoke:wsl-windows:integration` command remains the verification entry
point on a WSL development checkout without the machine-specific pnpm/release locks.
Set `LIVEDOCS_WSL_WINDOWS_LIFECYCLE_ONLY=1` with the integration opt-in to rerun only
the real cross-interop lifecycle check. Installer verification remains pending while
unrelated Windows pnpm/dev processes can hold packaging inputs; no unrelated process
was terminated.
