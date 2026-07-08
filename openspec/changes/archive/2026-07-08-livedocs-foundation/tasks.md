## 1. Project Scaffold

- [x] 1.1 Initialize pnpm workspace monorepo with TypeScript, ESLint/Prettier, and Vitest configured at the root
- [x] 1.2 Scaffold `apps/desktop` with electron-vite (main, preload, renderer with React), contextIsolation on, and a typed IPC helper
- [x] 1.3 Create empty package skeletons: `@livedocs/pipeline`, `@livedocs/analysis`, `@livedocs/generators`, `@livedocs/ai`, `@livedocs/store`
- [x] 1.4 Set up `@livedocs/store`: better-sqlite3 wrapper, per-workspace database under user-data dir, migration runner, and initial schema (files, symbols, imports, dependencies, commits, generated_artifacts, ai_cache)
- [x] 1.5 Verify dev loop: `pnpm dev` launches the app window with hot reload; electron-rebuild wired for better-sqlite3

## 2. Workspace Management

- [x] 2.1 Implement open-workspace flow (folder picker + recent-workspaces list persisted in the store)
- [x] 2.2 Build workspace tree UI with docs-focused view (Markdown files prominent) and full file tree, opening files on selection
- [x] 2.3 Integrate chokidar watcher with `.gitignore`-derived ignore rules, emitting typed change events over IPC
- [x] 2.4 Wire watcher events to tree updates and live refresh of the currently open document

## 3. Markdown Rendering

- [x] 3.1 Build `@livedocs/pipeline`: unified parse (remark-parse, remark-gfm, remark-directive) → mdast transforms → rehype-react rendering to React elements
- [x] 3.2 Add syntax highlighting for fenced code blocks (Shiki) with plain-text fallback for unknown languages
- [x] 3.3 Generate table of contents from headings with scroll-to navigation
- [x] 3.4 Handle links: relative Markdown links open in-app (with anchors), external links open in system browser
- [x] 3.5 Implement reading-view typography and light/dark themes covering prose, code, and diagrams
- [x] 3.6 Add pipeline extension point dispatching claimed code-fence languages and directives to registered transforms

## 4. Diagram Rendering

- [x] 4.1 Implement diagram renderer registry (language tag → async renderer returning SVG or error); unregistered tags fall back to code blocks
- [x] 4.2 Register Mermaid renderer with inline error display (original source shown) on invalid syntax
- [x] 4.3 Add enlarge-on-click diagram view with zoom and pan

## 5. Repository Analysis

- [x] 5.1 Implement source indexer in a worker thread: file inventory with language detection, persisted to the store, incremental on watcher events
- [x] 5.2 Add TS/JS extractor for exported symbols and import graph (es-module-lexer/ts-morph) behind a per-language extractor interface
- [x] 5.3 Parse `package.json` manifests into the dependencies table
- [x] 5.4 Integrate simple-git: current branch, recent commits with changed files, per-file history; degrade gracefully for non-Git workspaces
- [x] 5.5 Build FTS5 search over documents and indexed source with a search UI that opens results; keep index current on file changes

## 6. AI Layer

- [x] 6.1 Build `@livedocs/ai` wrapping the Vercel AI SDK: provider/model configuration (Anthropic, OpenAI, Google, Ollama), streaming with cancellation
- [x] 6.2 Store API keys via Electron safeStorage; settings UI for provider/model; unconfigured state explains setup instead of failing
- [x] 6.3 Implement ai_cache: responses keyed by hash(model + prompt + input digest), with cache-hit provenance and invalidation on input change
- [x] 6.4 Record provenance `{model, timestamp, inputDigest, cacheHit}` on every AI-produced artifact

## 7. Live Doc Generation

- [x] 7.1 Implement `:::generated{name=...}` directive handling: render stored artifact inline, inline error for unknown generators, authored content never modified
- [x] 7.2 Define generator interface `(analysisStore, params) → mdast + provenance + inputDigest` and registry
- [x] 7.3 Implement deterministic generators: `api-index` (from symbols), `dependency-graph` (emits Mermaid), `db-schema` (Prisma + SQL DDL detection; "no input found" message when absent)
- [x] 7.4 Implement AI generator `architecture-overview` summarizing module structure from the index
- [x] 7.5 Implement staleness: recompute input digests on watcher events, mark stale sections in the reading view, manual refresh action
- [x] 7.6 Style generated sections as visually distinct with an inspectable provenance popover

## 8. AI Document Workflows

- [x] 8.1 Implement explain-selection: AI explanation panel for selected document or source content, streamed, with provenance
- [x] 8.2 Implement summarize actions for a document and for recent repository changes (commits + diffs)
- [x] 8.3 Implement draft-update workflow: AI proposes a revision to an authored section, shown as a reviewable diff, applied to the file only on user acceptance

## 9. Verification & Polish

- [x] 9.1 Unit tests for pipeline transforms, generator digests/staleness, ai cache keying, and store migrations
- [x] 9.2 End-to-end smoke test (Playwright + Electron): open workspace → read doc with Mermaid + generated section → search → explain selection
- [x] 9.3 Exercise every spec scenario against the running app and fix gaps
- [x] 9.4 Write README covering setup, dev loop, and architecture map of the packages
