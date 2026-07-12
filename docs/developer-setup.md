# Development Setup

This guide covers the first-time developer setup for LiveDocs on Windows native,
Linux, and WSL. LiveDocs is a pnpm workspace with an Electron desktop app and native
SQLite dependencies, so Node, pnpm, Python, and a C/C++ build toolchain all need to be
available before the first successful install.

## Prerequisites

- Node.js 20 or newer. Node 24 LTS is recommended. Node 26 Current should work, but it
  is not the default development baseline until it reaches LTS.
- pnpm 11.11.0. The repo pins this through the `packageManager` field in
  `package.json`.
- Git. The app can open non-Git folders, but development workflows assume Git.
- Python 3 and a C/C++ build toolchain for `better-sqlite3` and Electron rebuilds.

Check the JavaScript toolchain:

```bash
node --version
pnpm --version
```

If `pnpm --version` does not report `11.11.0` inside this repo, use Corepack when it is
available:

```bash
corepack install
corepack use pnpm@11.11.0
```

Node 25 and newer no longer include Corepack. If `corepack` is unavailable, install pnpm
directly:

```bash
npm install -g pnpm@11.11.0
```

## Windows Native

Use these steps when developing and running the native Windows Electron app from a
Windows checkout such as `C:\Users\<you>\src-windows\livedocs`.

1. Install Node.js 24 LTS from the official Node.js installer or with `winget`:

   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```

   `winget install OpenJS.NodeJS` installs the latest Current release, which may be a
   newer major such as Node 26. That still satisfies this repo's `node >=20` engine, but
   use the LTS package if you want the version most likely to match CI and native
   dependency testing.

2. Enable or install the repo-pinned pnpm version:

   ```powershell
   corepack enable pnpm
   pnpm --version
   ```

   If Corepack fails with `EPERM` while writing under `C:\Program Files\nodejs`, rerun
   the command from an Administrator terminal, or install pnpm through npm:

   ```powershell
   npm install -g pnpm@11.11.0
   ```

   If you are using Node 26 or newer, Corepack is not bundled with Node. Use the npm
   install path for pnpm, or switch to Node 24 LTS.

3. Install Python:

   ```powershell
   winget install Python.Python.3.12
   ```

   Open a new terminal and verify:

   ```powershell
   python --version
   ```

   If this opens the Microsoft Store or says Python was not found, disable the
   `python.exe`/`python3.exe` App execution aliases in Windows Settings, or add the real
   Python install directory, such as
   `C:\Users\<you>\AppData\Local\Programs\Python\Python312`, to `PATH`.

4. Install Visual Studio Build Tools, or modify an existing Visual Studio install, to
   include the `Desktop development with C++` workload. Having Visual Studio installed
   is not enough; `node-gyp` needs the MSVC compiler tools and Windows SDK from this
   workload.

   To install the standalone Build Tools:

   ```powershell
   winget install Microsoft.VisualStudio.2022.BuildTools
   ```

   Then open the Visual Studio Installer and select `Desktop development with C++`.
   If you already have Visual Studio installed, use `Modify` in the Visual Studio
   Installer and add that workload to the existing install.

5. Install dependencies from the repo root:

   ```powershell
   pnpm install
   ```

   The install runs `electron-rebuild` for `better-sqlite3`. If the first install fails
   before the native rebuild completes, a second `pnpm install` can finish suspiciously
   quickly because packages were already linked. After fixing Python or build tools,
   rerun the rebuild explicitly:

   ```powershell
   pnpm --filter @livedocs/desktop rebuild
   ```

6. Start the app:

   ```powershell
   pnpm dev
   ```

## Linux And WSL

Use these steps for a Linux checkout or a WSL checkout. In WSL, keep this install
separate from any Windows `node_modules`; Electron and `better-sqlite3` native modules
cannot be shared across the Windows/Linux boundary.

1. Install Node.js 20 or newer, preferably Node 24 LTS. Use your distro package
   manager, `nvm`, `fnm`, Volta, or another version manager that can provide Node 20+.

2. Install native build prerequisites. On Debian/Ubuntu/WSL:

   ```bash
   sudo apt update
   sudo apt install -y git python3 make g++ build-essential
   ```

3. Enable the repo-pinned pnpm version:

   ```bash
   corepack enable pnpm
   pnpm --version
   ```

4. Install dependencies from the repo root:

   ```bash
   pnpm install
   ```

5. Start the Linux/WSLg dev app:

   ```bash
   pnpm dev
   ```

   The dev script detects WSL and sets `ELECTRON_DISABLE_SANDBOX=1` before Electron
   starts. If you launch Electron directly under WSL, set it yourself:

   ```bash
   ELECTRON_DISABLE_SANDBOX=1 ./node_modules/.bin/electron .
   ```

## Native Windows UI For A WSL Workspace

LiveDocs can also open a WSL-hosted repository in a native Windows Electron window
while repository IO, Git, indexing, file watching, and workspace SQLite state stay
inside WSL. The preferred workflow needs only one developer-managed checkout, stored in
the WSL filesystem. LiveDocs automatically creates a disposable NTFS build mirror and
keeps Windows/Electron-ABI dependencies there; the WSL checkout keeps its own
Linux/Node-ABI dependencies.

Install the normal Linux/WSL prerequisites above. On Windows, install Node.js, the
repo-pinned pnpm version, Python, and Visual Studio Build Tools with the `Desktop
development with C++` workload. WSL interop must be enabled so `powershell.exe`,
`node.exe`, and `taskkill.exe` are callable from WSL.

From the WSL checkout:

```bash
pnpm dev:windows-from-wsl
pnpm build:windows-from-wsl
pnpm dist:windows-from-wsl
```

The first run performs a Windows `pnpm install` and native rebuild, so it is slower.
Later runs reuse the mirror until a lockfile, package manifest, build configuration,
Node ABI, or pinned pnpm change invalidates it. By default mirrors and artifacts live
under `%LOCALAPPDATA%\LiveDocs\dev-mirrors`; set
`LIVEDOCS_WINDOWS_MIRROR_ROOT` to another absolute drive path to relocate them.
Build and installer artifacts intentionally remain in this disposable mirror. Copy any
installer you want to retain before running the clean command, which removes the mirror
and its artifacts together.

Use `pnpm launch:windows-from-wsl` to launch a prepared build, and
`pnpm clean:windows-from-wsl` to safely remove only the current checkout's owned mirror.
The installed-app launcher remains available through
`pnpm launch:installed-windows-from-wsl` and `livedocs .`.

See [Native Windows UI From WSL](wsl-native-windows.md) for protocol registration,
launcher overrides, packaging notes, and troubleshooting.

## Common Commands

Run these from the repo root:

```bash
pnpm dev        # launch the desktop app in development mode
pnpm test       # run Vitest unit tests
pnpm test:e2e   # run Playwright + Electron end-to-end tests
pnpm typecheck  # run TypeScript checks across packages
pnpm lint       # run ESLint
pnpm format     # format with Prettier
pnpm build      # build the desktop app
pnpm dist:win   # build a Windows installer
```

Useful launch environment variables:

| Variable              | Effect                                             |
| --------------------- | -------------------------------------------------- |
| `LIVEDOCS_WORKSPACE`  | Open this folder as the workspace at startup       |
| `LIVEDOCS_USER_DATA`  | Redirect app data and SQLite stores                |
| `LIVEDOCS_AI_MOCK`    | Force a mock AI provider                           |
| `LIVEDOCS_NO_SANDBOX` | Apply Chromium `--no-sandbox` at runtime           |
| `LIVEDOCS_DEVTOOLS`   | `1` opens detached DevTools in dev                 |
| `LIVEDOCS_DEBUG`      | Forward renderer console output to the terminal    |

## Verification

After setup, run:

```bash
pnpm typecheck
pnpm test
pnpm smoke:wsl-native
```

For the WSL-to-native-Windows path, also verify:

- `livedocs .` opens or focuses the Windows app.
- A second `livedocs <path>` request reuses the running app instance.
- File browsing, Markdown rendering, accepted edits, search, Git overview, and Git file
  history work through the WSL agent for the selected distro/path.

## Troubleshooting

- `corepack enable pnpm` fails on Windows with `EPERM`: run the command from an
  Administrator terminal, or use `npm install -g pnpm@11.11.0`.
- `pnpm` fails with `Cannot find module ...\corepack\dist\pnpm.js` after a Node
  upgrade: Node 25 and newer do not bundle Corepack. Switch to Node 24 LTS, or install
  pnpm directly with `npm install -g pnpm@11.11.0 --force` from an Administrator
  terminal to replace the stale shim.
- `electron-rebuild` says it cannot find Python: install Python, open a new terminal,
  verify `python --version`, then run `pnpm --filter @livedocs/desktop rebuild`.
- `python --version` resolves to the Microsoft Store alias instead of real Python:
  disable the Python App execution aliases in Windows Settings, or add the real Python
  install directory to `PATH`.
- `node-gyp` says it cannot find a Visual Studio installation: install or modify Visual
  Studio so it includes the `Desktop development with C++` workload, then open a new
  terminal and rerun `pnpm --filter @livedocs/desktop rebuild`.
- `node-gyp` fails after Python is installed: install Visual Studio Build Tools on
  Windows, or `build-essential`/`make`/`g++` on Linux.
- Native Windows UI for a WSL folder reports `WSL agent stopped (exit code 127)`:
  install Linux Node.js inside WSL, run `pnpm build`, and rerun
  `pnpm --filter @livedocs/desktop install:wsl-launcher` from the WSL checkout.
- WSL Electron opens a blank window or crashes with sandbox/shared-memory errors: use
  `pnpm dev`, or set `ELECTRON_DISABLE_SANDBOX=1` before launching Electron directly.
- Electron exits immediately from an integrated terminal: make sure
  `ELECTRON_RUN_AS_NODE` is not set in that shell.
