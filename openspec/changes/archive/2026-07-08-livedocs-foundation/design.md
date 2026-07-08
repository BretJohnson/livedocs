## Context

The repository contains only the product vision ([docs/LiveDocs-Proposal-v2.md](../../docs/LiveDocs-Proposal-v2.md)) — there is no code yet. This design covers the foundational increment: a desktop app that opens a local repository, renders Markdown and diagrams excellently, analyzes the repo, embeds generated documentation sections with provenance, and exposes a provider-independent AI layer. The vision doc explicitly invites architecture improvements over its suggestions.

## Goals / Non-Goals

**Goals:**
- A working end-to-end desktop application covering the six foundation capabilities.
- An architecture where the Markdown pipeline, analysis engine, generators, and AI layer are separable packages that later changes extend rather than rework.
- Local-first: everything except cloud AI calls works offline.

**Non-Goals:**
- Diff/change-review workflows, staleness dashboards, security matrices, UI-flow extraction, multi-repo workspaces (future changes).
- Diagram formats beyond Mermaid (the registry makes them additive later).
- A Markdown *editor* — this increment is a reading/reviewing surface; authored edits happen in the user's editor, with AI-drafted updates applied as whole-file writes after approval.
- Deep semantic indexing (LSP-grade symbol resolution); the foundation index is file/export/import-level.

## Decisions

### Monorepo with process-separated architecture
Electron app structured as a pnpm workspace: `apps/desktop` (main + renderer) and packages `@livedocs/pipeline` (Markdown), `@livedocs/analysis` (git/index/deps/search), `@livedocs/generators`, `@livedocs/ai`, `@livedocs/store` (SQLite). Heavy work (indexing, analysis, AI calls, SQLite) lives in the main process / worker threads; the renderer is a pure React view layer talking over typed IPC (contextIsolation on, no Node in renderer). *Alternative considered:* single-package app — faster to start but couples the pipeline and analysis to Electron, blocking a future CLI/CI reuse of the same engines.

### Electron + React + Vite via electron-vite
Accept the vision doc's suggestion. *Alternative considered:* Tauri — smaller binaries, but the ecosystem around Node-native tooling we need (better-sqlite3, chokidar, unified) and team familiarity favor Electron; revisit only if footprint becomes a real complaint.

### unified/remark/rehype AST pipeline with a directive convention for generated sections
Documents are parsed to mdast, transformed, and rendered to React elements (rehype-react), never to HTML strings — this is what lets diagram nodes and generated sections be first-class React components. Generated sections are expressed with remark-directive container syntax (`:::generated{name="dependency-graph"}`), which stays valid, readable Markdown in any other viewer. Generated output is stored in the SQLite store and rendered into the section at view time; the authored file only ever contains the directive marker, which trivially guarantees the "authored content never modified" requirement. *Alternative considered:* writing generated output into the file between HTML comment markers (docs-as-code style) — better for viewing on GitHub, but makes file churn, merge conflicts, and provenance much harder; can be added later as an "export/materialize" feature.

### Diagram renderer registry
A map from code-fence language → renderer component. Mermaid renders client-side in the renderer process (it's browser-native); the registry interface is async and returns SVG-or-error so out-of-process renderers (Graphviz WASM, PlantUML server) slot in later. Invalid diagram source renders an inline error block with the original code — never crashes the document.

### Analysis engine: simple-git + chokidar + per-language extractors
Git metadata via `simple-git` shelling out to the system git (fast, battle-tested; isomorphic-git avoided because repo-size performance matters more than bundling git). File watching via chokidar with `.gitignore`-derived ignore rules. Dependency/module analysis starts with manifest parsing (`package.json`) plus TS/JS import graphs via `es-module-lexer`/ts-morph on changed files only; extractors register per language so Python/Go arrive as plugins. All analysis results land in SQLite.

### SQLite (better-sqlite3) with FTS5 for search
One database per workspace stored under the app's user-data directory keyed by workspace path hash — nothing is written into the user's repository. Tables: files, symbols, imports, dependencies, commits, generated_artifacts (with provenance JSON), ai_cache. Search is SQLite FTS5 over document + source text — no separate search engine. *Alternative considered:* keeping a `.livedocs/` folder in the repo — rejected for the foundation to keep the tool zero-footprint; export can come later.

### AI layer: Vercel AI SDK as the provider abstraction
Use the `ai` package's provider interface (Anthropic, OpenAI, Google, Ollama for local) rather than hand-rolling one — it gives streaming, tool-calling, and provider swap for free, and we wrap it behind our own thin `@livedocs/ai` interface so it stays replaceable. Responses cached in `ai_cache` keyed by hash(model + prompt + input digest). API keys in OS keychain via Electron `safeStorage`. Every AI artifact records `{model, timestamp, inputDigest, cacheHit}` provenance. Default model when the user configures Anthropic: `claude-sonnet-5`.

### Generators as pure functions over the store
A generator is `(analysisStore, params) → mdast subtree + provenance + inputDigest`. Staleness = current input digest ≠ stored digest, recomputed on watcher events. Foundation generators: `architecture-overview` (AI-summarized module structure), `api-index` (deterministic, from symbols table), `dependency-graph` (deterministic, emits Mermaid), `db-schema` (parses detectable schema files, e.g., Prisma/SQL DDL). Deterministic generators never call AI — provenance distinguishes the two.

## Risks / Trade-offs

- [Indexing large repos is slow or memory-heavy] → Index in a worker thread, incremental from the first build, cap file size and count with clear UI messaging; document reading never blocks on indexing.
- [Generated-in-store sections invisible on GitHub/other viewers] → Accepted for foundation; directive blocks degrade to a visible labeled container. A "materialize to file" exporter is an identified follow-up change.
- [AI provider/SDK churn (Vercel AI SDK majors move fast)] → All app code depends on `@livedocs/ai`'s own interface; the SDK is an implementation detail of one package.
- [better-sqlite3 native module vs Electron ABI] → Pin Electron + use electron-rebuild in CI; fallback path to WASM sqlite if packaging pain persists.
- [AI-generated summaries may be wrong and erode trust] → Provenance is mandatory and visible; deterministic generators are preferred wherever the data supports them; AI drafts to authored files always require explicit approval.
- [Scope creep — six capabilities is a large first change] → Tasks are ordered so each capability lands as a usable vertical slice; markdown reading works end-to-end before analysis/AI begin.

## Migration Plan

Greenfield — no migration. Rollback story per capability: features degrade independently (no git → analysis views hide; no AI key → AI actions explain setup; watcher failure → manual refresh still works).

## Open Questions

- Which database schema formats to detect first for the `db-schema` generator (Prisma and raw SQL DDL proposed; ORMs like Drizzle/SQLAlchemy later)?
- Should the AI `architecture-overview` generator run automatically on first workspace open, or only on explicit insertion? (Proposed: explicit only, to keep first-open fast and cheap.)
- Packaging/distribution targets for the first release (macOS/Windows/Linux, auto-update) — deferred until the app is demoable.
