# Native Windows UI From WSL

LiveDocs can open a WSL-hosted repository in a native Windows Electron window while
workspace IO stays inside the selected distro. The Windows app receives a typed WSL
workspace reference (`kind`, `distro`, POSIX `path`) and talks to a Node agent in WSL over
the shared protocol.

## Development

For first-time Windows, Linux, and WSL prerequisites, see
[Developer Setup](developer-setup.md).

Keep the authoritative repository in the WSL filesystem and install its Linux
dependencies normally. LiveDocs creates and owns a separate NTFS mirror for native
Windows builds. Windows `node_modules`, Electron-ABI modules, output, and caches remain
in that mirror; they are never copied into or consumed from the WSL checkout.

The existing WSLg fallback remains:

```bash
pnpm dev
```

For the native Windows path from WSL:

```bash
pnpm dev:windows-from-wsl
pnpm build:windows-from-wsl
pnpm dist:windows-from-wsl
```

Development performs an initial reconciliation, builds and installs the WSL agent with
Linux Node, prepares Windows dependencies with Windows Node, then starts Electron/Vite
from the mirror. WSL source changes are batched into the mirror; a sync error ends the
session so the UI cannot silently run stale code. Ctrl+C stops the watcher and requests
termination of the Windows process tree.

`build` and `dist` synchronize once without watching. Their output remains under the
mirror's `apps\desktop\out` and `apps\desktop\release` directories, which are visible
from WSL through `/mnt/<drive>`. `launch` uses a compatible prepared build or registered
installed app. This is an intentional cache-oriented policy: copy installers elsewhere
before cleanup if they must be retained. `clean` deletes the mirror and all build and
installer artifacts inside it, but only when ownership metadata matches the current
distro and canonical checkout path; pass `-- --list` to the desktop clean script when
inspecting generated mirrors.

The mirror defaults to `%LOCALAPPDATA%\LiveDocs\dev-mirrors` and is keyed by distro plus
canonical POSIX checkout path. Its pnpm store is mirror-local to avoid interference from
other Windows pnpm installs. Set `LIVEDOCS_WINDOWS_MIRROR_ROOT` to an absolute Windows
drive path to relocate it, or `LIVEDOCS_WSL_DISTRO` to override distro selection for a
multi-distro diagnostic run. Every mirror contains a warning file: it is disposable,
must not be edited, and synchronization is strictly WSL to Windows.

Synchronized inputs include repository source, workspace/package manifests, lockfiles,
and build configuration. LiveDocs excludes repository metadata, every `node_modules`,
build/release/test output, coverage, logs, mirror metadata, and local `.env` secrets.
`.env.example` files are included. A source-owned manifest controls stale deletion, so
Windows-owned dependencies and output are preserved.

If a Windows file picker returns a WSL UNC path such as
`\\wsl$\Ubuntu\home\me\repo` or `\\wsl.localhost\Ubuntu\home\me\repo`, LiveDocs converts
it to a WSL workspace reference and opens it through the WSL agent. It should not be
watched or indexed as an ordinary Windows network share.

## Published Install

The Windows app registers the `livedocs://` protocol and handles second-instance launch
requests. The WSL launcher can be installed independently:

```bash
pnpm --filter @livedocs/desktop install:wsl-launcher
livedocs .
```

The WSL-driven distribution command runs packaging with native Windows Node and Windows
dependencies, so Electron and `better-sqlite3` use the correct ABI. Windows CI remains
appropriate for release automation.

## Troubleshooting

- `livedocs .` says the Windows app cannot be invoked: install the Windows app, enable WSL
  interop, or set `LIVEDOCS_WINDOWS_LAUNCHER` and optional
  `LIVEDOCS_WINDOWS_LAUNCHER_ARGS`.
- A WSL-driven command reports missing prerequisites: verify `powershell.exe` interop,
  Windows Node, pnpm 11.11.0, Python, and the Visual Studio C++ workload. Run the commands
  from an ordinary WSL shell whose Windows PATH is imported.
- A dependency install or native rebuild fails: run `pnpm clean:windows-from-wsl` after
  fixing the Windows prerequisite, then retry. Never copy either environment's
  `node_modules` into the other.
- A mirror is incompatible or has unexpected ownership: do not delete arbitrary paths
  through the script. Inspect `%LOCALAPPDATA%\LiveDocs\dev-mirrors`, confirm its
  `README-LIVEDOCS-MIRROR.txt` and `.livedocs-mirror\owner.json`, then use the clean
  command for the matching WSL checkout.
- Source edits do not reload: check the WSL terminal for a synchronization failure. The
  command intentionally terminates instead of leaving Electron on stale source.
- The app reports a protocol mismatch: rebuild/reinstall the Windows app and WSL-side
  agent from the same LiveDocs version.
- The app reports `WSL agent stopped (exit code 127)`: install Linux Node.js inside WSL,
  run `pnpm build`, then rerun
  `pnpm --filter @livedocs/desktop install:wsl-launcher` from the WSL checkout.
- A WSL workspace opens but Git/search/indexing are unavailable: check that WSL has Git,
  dependencies, and a Linux-compatible `node_modules` install.
- If a WSL workspace opens as a local Windows/network path instead of
  `~/path [WSL: Distro]`, update LiveDocs and use the WSL launcher or a `\\wsl$`/
  `\\wsl.localhost` path so repository operations stay on the POSIX path inside the
  distro.

## Verification

Run the mocked launch smoke check anywhere:

```bash
pnpm smoke:wsl-native
pnpm smoke:wsl-windows
```

For the full boundary test on a configured development machine:

```bash
LIVEDOCS_RUN_WSL_WINDOWS_INTEGRATION=1 pnpm smoke:wsl-windows:integration
```

This prepares the Linux agent, runs a native Windows production build, checks the agent
protocol handshake for a POSIX workspace, and exercises synchronization additions,
changes, removals, exclusions, mode selection, and diagnostics. Interrupt the real dev
command once during release qualification to confirm no Electron/Vite descendants or
watcher remain.

On a Windows + WSL machine, also verify:

- `livedocs .` opens or focuses the Windows app.
- A second `livedocs <path>` request reuses the running app instance.
- File browsing, Markdown rendering, accepted edits, search, Git overview, and Git file
  history operate through the WSL agent for the selected distro/path.
