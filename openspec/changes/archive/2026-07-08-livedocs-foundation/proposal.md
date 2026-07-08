## Why

Software is increasingly written with AI assistance, but humans remain responsible for verifying that it behaves as intended — and reading source code no longer scales as the primary way to do that. LiveDocs ([docs/LiveDocs-Proposal-v2.md](../../../docs/LiveDocs-Proposal-v2.md)) is a desktop application that becomes the human-readable representation of a software system: authored Markdown, repository analysis, generated documentation, diagrams, and AI-assisted explanation in one place. This change establishes the foundational product — the repository is currently empty, so this is the first buildable increment.

## What Changes

- Scaffold the LiveDocs desktop application (Electron + React + TypeScript + Vite) with a local SQLite store for indexes, caches, and generated artifacts.
- Add workspace management: open a local repository/folder, browse its documentation and source tree, and watch for file changes.
- Add a best-in-class Markdown reading experience built on a structured unified/remark/rehype pipeline (syntax highlighting, table of contents, cross-document links).
- Add diagram rendering, starting with Mermaid, behind an extensible renderer interface (Graphviz, PlantUML, D2 later).
- Add repository analysis: Git integration, source indexing, dependency extraction, and repository search that feed generated documentation.
- Add live documentation: authored Markdown with embedded generated sections (architecture summaries, API indexes, database schemas, dependency graphs) that regenerate as the code evolves, each carrying provenance (inputs, generation time, cache status, model).
- Add a provider-independent AI layer (multiple cloud/local models, streaming, caching, provenance) powering explanation, summarization, and documentation-update workflows embedded in the documents rather than centered on chat.

Out of scope for this change (future proposals): review workflows for AI-generated diffs, staleness detection, security/permission matrices, UI-flow extraction, and multi-repo workspaces.

## Capabilities

### New Capabilities

- `workspace-management`: Opening a local repository as a workspace, browsing its file/document tree, and reacting to file-system changes.
- `markdown-rendering`: Rendering authored Markdown documents through a structured transformation pipeline with navigation, syntax highlighting, and cross-document linking.
- `diagram-rendering`: Rendering diagrams embedded in documents, starting with Mermaid, through an extensible renderer interface.
- `repository-analysis`: Indexing a repository's source, Git history, and dependencies, and exposing search over the results.
- `live-doc-generation`: Generating and refreshing documentation sections (architecture, API, schema, dependency views) from repository analysis, with provenance metadata on all generated content.
- `ai-integration`: A provider-independent AI service layer with streaming, caching, and provenance that powers explanation and documentation-maintenance workflows.

### Modified Capabilities

_None — this is a greenfield project with no existing specs._

## Impact

- **Code**: New application from scratch — Electron main/renderer processes, shared TypeScript packages for the Markdown pipeline, analysis engine, and AI layer.
- **Dependencies**: Electron, React, Vite, TypeScript, unified/remark/rehype, Mermaid, a Git library (e.g., isomorphic-git or simple-git), a file watcher (e.g., chokidar), SQLite (e.g., better-sqlite3), and AI provider SDKs.
- **Systems**: Local-only footprint (SQLite database, on-disk caches). Network access is required only for cloud AI providers; API keys must be stored securely on the user's machine.
