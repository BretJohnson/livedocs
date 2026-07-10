# Native Windows UI From WSL

LiveDocs can open a WSL-hosted repository in a native Windows Electron window while
workspace IO stays inside the selected distro. The Windows app receives a typed WSL
workspace reference (`kind`, `distro`, POSIX `path`) and talks to a Node agent in WSL over
the shared protocol.

## Development

Use separate installs:

- In WSL: install repository dependencies for source analysis, Git, the WSL launcher, and
  Node-ABI native modules.
- In Windows: install desktop dependencies for the native Electron runtime and
  Windows/Electron-ABI native modules.

The existing WSLg fallback remains:

```bash
pnpm dev
```

For the native Windows path from WSL:

```bash
pnpm build
pnpm --filter @livedocs/desktop install:wsl-launcher
pnpm dev:windows-from-wsl
```

`pnpm dev:windows-from-wsl` invokes the same `livedocs://wsl/open?...` bridge as the
installed launcher. Set `LIVEDOCS_WINDOWS_LAUNCHER` to an executable that accepts that
URL as its final argument when testing without a registered Windows app. Extra leading
arguments can be supplied with `LIVEDOCS_WINDOWS_LAUNCHER_ARGS` as a JSON array.
The Windows app uses the same executable-plus-JSON-args pattern for
`LIVEDOCS_WSL_AGENT_COMMAND` and `LIVEDOCS_WSL_AGENT_ARGS` when overriding the agent
launch command during tests.

## Published Install

The Windows app registers the `livedocs://` protocol and handles second-instance launch
requests. The WSL launcher can be installed independently:

```bash
pnpm --filter @livedocs/desktop install:wsl-launcher
livedocs .
```

Windows installers should be produced on Windows CI so Electron and `better-sqlite3`
native modules are built for the correct ABI. The WSL launcher should be packaged or
installed from inside WSL so the agent uses Linux/Node-compatible dependencies.

## Troubleshooting

- `livedocs .` says the Windows app cannot be invoked: install the Windows app, enable WSL
  interop, or set `LIVEDOCS_WINDOWS_LAUNCHER` and optional
  `LIVEDOCS_WINDOWS_LAUNCHER_ARGS`.
- The app reports a protocol mismatch: rebuild/reinstall the Windows app and WSL-side
  agent from the same LiveDocs version.
- A WSL workspace opens but Git/search/indexing are unavailable: check that WSL has Git,
  dependencies, and a Linux-compatible `node_modules` install.
- Do not point the Windows app at `\\wsl$` for WSL-backed analysis. Use the WSL launcher
  so repository operations stay on the POSIX path inside the distro.

## Verification

Run the mocked launch smoke check anywhere:

```bash
pnpm smoke:wsl-native
```

On a Windows + WSL machine, also verify:

- `livedocs .` opens or focuses the Windows app.
- A second `livedocs <path>` request reuses the running app instance.
- File browsing, Markdown rendering, accepted edits, search, Git overview, and Git file
  history operate through the WSL agent for the selected distro/path.
