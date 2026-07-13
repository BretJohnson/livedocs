# LiveDocs

LiveDocs is a desktop application that becomes the human-readable representation of a
software system: authored Markdown, repository analysis, generated documentation,
diagrams, and AI-assisted explanation in one place. Open a repository as a workspace and
read its documentation with live-updating generated sections, full-text search, Git
history, and document-embedded AI workflows.

Everything except cloud AI calls works offline. Nothing is ever written into your
repository except edits you explicitly accept.

## Setup

Prerequisites: Node.js ≥ 20 (Node 24 recommended), the repo-pinned pnpm version, and a
C/C++ toolchain for the SQLite native module. Git is optional at runtime — non-Git
workspaces degrade gracefully. See [Developer Setup](docs/developer-setup.md) for
Windows, Linux, and WSL setup steps.

```bash
pnpm install   # installs, builds better-sqlite3, and runs electron-rebuild
```

## Dev loop

```bash
pnpm dev        # launch the app with renderer HMR and main-process hot restart
pnpm dev:windows-from-wsl
                # from a WSL checkout, build/sync/launch the native Windows app
pnpm build:windows-from-wsl
                # one-shot native Windows production build driven from WSL
pnpm dist:windows-from-wsl
                # create the Windows installer from the same WSL checkout
pnpm test       # unit tests (Vitest) across all packages
pnpm test:e2e   # Playwright + Electron end-to-end suite (builds first)
pnpm smoke:wsl-native
                # mocked smoke check for the WSL launcher/deep-link path
pnpm typecheck  # tsc --noEmit in every package
pnpm lint       # ESLint
pnpm format     # Prettier
pnpm build      # production build via electron-vite
```

Useful launch environment variables (used by the e2e suite, handy for scripting):

| Variable              | Effect                                             |
| --------------------- | -------------------------------------------------- |
| `LIVEDOCS_WORKSPACE`  | Open this folder as the workspace at startup       |
| `LIVEDOCS_USER_DATA`  | Redirect app data (SQLite stores) — test isolation |
| `LIVEDOCS_AI_MOCK`    | Force a mock AI provider (no network, no key)      |
| `LIVEDOCS_NO_SANDBOX` | Apply Chromium `--no-sandbox` at runtime           |
| `LIVEDOCS_DEVTOOLS`   | `1` opens detached DevTools in dev                 |
| `LIVEDOCS_DEBUG`      | Forward renderer console output to the terminal    |

### Running under WSL

`pnpm dev` is still the Linux Electron / WSLg fallback. It detects WSL and sets
`ELECTRON_DISABLE_SANDBOX=1` automatically (via
`scripts/dev.mjs`). This is required: WSL's kernel rejects Chromium's shared-memory
syscalls under the sandbox, and the env var must be set _before_ Electron launches —
a runtime `--no-sandbox` switch is applied too late, so the renderer would crash
(exit 133) and the window would be blank. You'll see harmless
`platform_shared_memory_region` warnings in the log either way; they don't affect
rendering once the sandbox is disabled.

If you launch the built app directly under WSL (not via `pnpm dev`), set the env var
yourself: `ELECTRON_DISABLE_SANDBOX=1 ./node_modules/.bin/electron .`

Also: if you launch from inside another Electron app's integrated terminal (e.g. VS
Code/Cursor), make sure `ELECTRON_RUN_AS_NODE` is not set, or Electron starts as plain
Node and exits immediately.

The preferred native Windows UI path uses one authoritative checkout in WSL. Running
`pnpm dev:windows-from-wsl` builds and installs the Linux WSL agent, synchronizes source
one way into a disposable NTFS mirror, installs isolated Windows dependencies there,
and launches native Windows Electron with live source updates. The WSL and Windows
`node_modules` trees are never shared. The older installed-app bridge remains available
as `pnpm launch:installed-windows-from-wsl` or `livedocs .`. See
[Developer Setup](docs/developer-setup.md) for prerequisites and
[docs/wsl-native-windows.md](docs/wsl-native-windows.md) for protocol, packaging, and
troubleshooting details.

## Architecture map

pnpm workspace monorepo. The desktop app is a thin shell; all engines are separable
TypeScript packages (consumed as source, bundled by electron-vite) so a future CLI/CI
can reuse them without Electron.

```
apps/desktop            Electron shell
  src/shared/ipc.ts     The single typed IPC contract (invoke + event maps)
  src/main/             Main process: session, handlers, indexer worker host,
                        AI config (safeStorage), generator host, workflows
  src/preload/          contextBridge exposing the typed `window.livedocs` API
  src/renderer/         React reading UI: tree, reading view, TOC, diagrams,
                        generated sections, AI panel, draft-diff review, settings
  e2e/                  Playwright + Electron smoke and spec-scenario suites

packages/store          @livedocs/store — better-sqlite3 wrapper, migration runner,
                        per-workspace DB (files, symbols, imports, dependencies,
                        commits, generated_artifacts, ai_cache, FTS5 search_index)
                        plus the app-global store (recents, settings) and shared
                        workspace reference/protocol types
packages/analysis       @livedocs/analysis — indexer (worker-thread entry),
                        .gitignore-aware watcher (chokidar), TS/JS extractor
                        (es-module-lexer) behind a per-language interface,
                        package.json manifests, simple-git integration
packages/pipeline       @livedocs/pipeline — unified/remark/rehype pipeline to React
                        elements (never HTML strings), GFM + directives, heading
                        ids/TOC, Shiki code blocks, extension point dispatching
                        claimed fences and :::generated directives
packages/generators     @livedocs/generators — generator registry; deterministic
                        api-index, dependency-graph (emits Mermaid), db-schema
                        (Prisma + SQL DDL); AI architecture-overview. A generator is
                        (store, params) → mdast + provenance + inputDigest
packages/ai             @livedocs/ai — provider-independent AI service over the
                        Vercel AI SDK (Anthropic, OpenAI, Google, Ollama, mock):
                        streaming, cancellation, response cache keyed by
                        hash(model + prompt + input digest), provenance
```

Data flow: the watcher batches file events → the indexer worker updates the SQLite
store → generated-section input digests are recomputed (stale sections get marked in
the reading view) → the renderer refreshes affected views over typed IPC. Generated
output lives in the store and is rendered into `:::generated{name=…}` sections at view
time, so authored files are never modified by generation; AI-drafted edits are applied
only after you accept the diff.

## Workspace configuration

Place an optional `livedocs.jsonc` file at the workspace root to control which Markdown
files appear in the Docs tab. The file supports JSON comments and trailing commas:

```jsonc
{
  "docs": {
    "include": ["docs/**", ".agents/skills/**/*.md"],
    "exclude": ["docs/archive/**"],
  },
}
```

`docs.include` and `docs.exclude` are optional arrays of workspace-relative globs using
forward slashes on every platform. With no includes, all `.md` and `.markdown` files
are candidates. Markdown beneath a directory whose name starts with `.` is hidden from
the Docs tab by default; an explicit include can opt it back in. Excludes are applied
last and always win. These settings do not remove files from the Files tab or source
indexing.

LiveDocs reloads the root configuration when it changes. If the file is malformed or a
supported field has the wrong type, the workspace remains open, default document
visibility is used, and a warning identifies the configuration error. Nested
`livedocs.jsonc` files are not treated as configuration.

### Note on better-sqlite3 and ABIs

The repo intentionally carries two copies of `better-sqlite3`: `apps/desktop` floats
`^12.1` and is rebuilt for Electron's ABI (`electron-rebuild`, wired into
`postinstall`), while `@livedocs/store` pins `12.0.0` and stays on the Node ABI so
Vitest can load it. `scripts/rebuild-store-sqlite.mjs` restores the store copy after
electron-rebuild runs (it traverses workspace links and would otherwise rebuild both).
At runtime the bundled main process resolves the Electron-ABI copy; tests resolve the
Node-ABI copy.

## AI configuration

Open Settings (⚙) and pick a provider — Anthropic (default model `claude-sonnet-5`),
OpenAI, Google, or a local Ollama endpoint. API keys are encrypted with Electron
`safeStorage` (OS keychain) and stored in the app database, never in workspace files or
logs. With no provider configured, all non-AI features work and AI actions explain how
to set one up.
