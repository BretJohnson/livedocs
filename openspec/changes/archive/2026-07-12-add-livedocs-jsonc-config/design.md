## Context

Document navigation is currently derived in the renderer by pruning the general workspace tree to nodes marked `isMarkdown`. Tree walking, repository indexing, and file watching share the analysis package's fixed and `.gitignore`-derived path filter. WSL workspaces use the same `NodeWorkspaceService` behind an agent protocol, so configuration must be loaded and evaluated where the workspace filesystem is native rather than in the Windows renderer.

The requested rules affect what LiveDocs presents as documentation, not whether files exist in the full tree or participate in source analysis. Conflating document visibility with the existing path filter would make explicitly included dot-directory documents impossible when a directory is pruned before traversal and could unexpectedly remove source data.

## Goals / Non-Goals

**Goals:**

- Define a small, typed, forward-compatible `livedocs.jsonc` model beginning with `docs.include` and `docs.exclude`.
- Produce identical document selection for local and WSL-backed workspaces.
- Hide Markdown beneath dot-prefixed directories by default while permitting explicit opt-in.
- Apply config changes during an open session and report invalid config without making the workspace unusable.
- Keep configured document visibility separate from the full file tree and general source indexing.

**Non-Goals:**

- Supporting configuration filenames or locations other than root `livedocs.jsonc`.
- Applying nested configuration files or inheritance across directories.
- Changing `.gitignore`, fixed repository ignores, source indexing, or watcher traversal semantics for files other than the root LiveDocs configuration.
- Adding configuration for rendering, themes, generation, or AI behavior in this change.
- Providing an in-app configuration editor.

## Decisions

### Use a dedicated workspace configuration module

Add a shared Node-side module that reads, parses, validates, and normalizes the root file into a `LiveDocsConfig` result containing effective settings and diagnostics. The `NodeWorkspaceService` owns the result so local and WSL flows use the same implementation. JSONC parsing will use a focused parser that supports comments and trailing commas and returns useful locations; validation remains explicit and narrow at the boundary.

This is preferred over parsing in the renderer because the renderer cannot natively access WSL paths and should receive already-classified workspace data. It is also preferred over extending the repository ignore filter because visibility and traversal have different semantics.

### Define the initial schema under `docs`

The supported shape is:

```jsonc
{
  "docs": {
    "include": ["docs/**", ".agents/skills/**/*.md"],
    "exclude": ["docs/archive/**"]
  }
}
```

Both properties are optional arrays of non-empty glob strings. Omitted or empty includes mean all recognized Markdown (`.md` and `.markdown`) are candidates; omitted or empty excludes add no exclusions. Unknown properties are ignored for forward compatibility, while wrong supported-property types and invalid glob syntax invalidate the configuration and produce a diagnostic. A schema version is deferred until incompatible semantics are contemplated.

Alternatives considered were top-level `include`/`exclude`, which leaves little namespace for future display settings, and ordered gitignore-style rules, which are powerful but make precedence and validation harder to explain.

### Use deterministic document-selection precedence

All paths are normalized to workspace-relative forward-slash form before matching. A file is a visible document when:

1. It is a recognized Markdown file and is not removed by the existing repository traversal filter.
2. With non-empty explicit includes, it matches at least one include; otherwise all Markdown files are candidates.
3. If any directory segment starts with `.`, it matches at least one explicit include. Thus broad explicit patterns such as `**/*.md` intentionally opt hidden paths in.
4. It does not match an exclude; excludes always win.

Compile glob matchers once per loaded configuration rather than once per file. Matching is case-sensitive and separator-independent through normalization, yielding consistent semantics across local Windows and WSL. This explicit precedence is preferred over injecting implicit exclude globs because a generic glob library's negation/order rules could make opt-in behavior surprising.

### Classify documents in the workspace service

Extend tree file metadata with a document-visibility classification (for example `isDocument`) while retaining `isMarkdown` as the file-type fact used for rendering and icons. `buildTree` receives the effective document selector and marks each Markdown file. The renderer's docs pruning uses `isDocument`; the full file tab continues to render all traversed nodes.

This keeps policy out of React and naturally crosses the WSL agent protocol with the existing tree payload. Computing a second docs-only tree was considered, but duplicating tree construction would increase I/O and protocol surface.

### Fall back atomically on invalid configuration

Parsing and validating produce either a complete effective config or the built-in defaults; partially valid fields are not applied. A diagnostic includes the config path and a concise parse or field error and is carried with workspace state or a dedicated diagnostic field suitable for UI display. The workspace still opens.

Atomic fallback avoids ambiguity about which portions took effect. Logging alone was rejected because users need a visible explanation when their requested display rules are ignored.

### Reload through existing workspace change events

The root config file is explicitly exempt from `.gitignore`-derived watcher exclusions so a configuration honored at open always remains reloadable. On add/change/unlink of exactly `livedocs.jsonc`, the service reloads configuration and emits updated workspace/tree state so the docs navigation refreshes. Matcher state is replaced atomically. Normal file changes continue through the existing debounced path.

If the config becomes invalid, defaults replace the previous valid config rather than silently retaining stale behavior; this matches what a fresh open would do and makes current file contents authoritative.

## Risks / Trade-offs

- [Broad include patterns opt dot directories in more widely than intended] → Document the precedence and provide excludes as the final override.
- [A glob dependency may differ in edge-case syntax across platforms] → Normalize paths, configure one documented syntax, and add parity tests using Windows- and POSIX-shaped inputs.
- [Tree refreshes can race with rapid config writes] → Reuse debounced watcher batches and atomically replace the compiled selector only after a complete load.
- [Invalid configuration diagnostics require protocol/UI changes] → Keep diagnostics structured and optional so older/no-config workspace behavior remains straightforward.
- [Unknown keys can hide typos] → Ignore them for forward compatibility in this first schema, but validate all recognized keys strictly and document supported fields.

## Migration Plan

1. Add the parser, validation model, selector, and unit tests without changing default UI classification.
2. Integrate classification and diagnostics into workspace opening/tree payloads for local and WSL-backed services.
3. Switch docs pruning to the new classification and add reload/integration coverage.
4. Ship with no workspace migration: repositories without `livedocs.jsonc` automatically receive the new dot-directory docs default.

Rollback consists of removing config integration and reverting docs pruning to `isMarkdown`; no persisted user data or database schema requires reversal.

## Open Questions

- None required for implementation. Future capabilities can decide whether configuration diagnostics need a general diagnostics panel beyond the initial workspace warning surface.
