## 1. Configuration Model and Parsing

- [x] 1.1 Add the JSONC and glob-matching dependencies in the appropriate shared Node package and define typed raw/effective config plus structured diagnostic types.
- [x] 1.2 Implement root-only `livedocs.jsonc` loading, JSONC parsing, strict validation of supported `docs.include` and `docs.exclude` fields, unknown-key tolerance, and atomic fallback to defaults.
- [x] 1.3 Implement compiled document selection over normalized forward-slash paths, including Markdown recognition, include selection, dot-directory opt-in, and exclude-wins precedence.
- [x] 1.4 Add parser and selector unit tests covering absent, valid, malformed, and type-invalid configs; trailing commas/comments; `.md`/`.markdown`; glob precedence; dot directories; and Windows/WSL path parity.

## 2. Workspace Integration

- [x] 2.1 Load and retain effective configuration and diagnostics when `NodeWorkspaceService` opens either a local or WSL-backed workspace.
- [x] 2.2 Extend shared tree/workspace protocol types with document classification and optional configuration diagnostics, preserving `isMarkdown` as the Markdown file-type fact.
- [x] 2.3 Update tree construction to apply the document selector without changing existing repository traversal ignores, the full file tree, or general source indexing.
- [x] 2.4 Detect root `livedocs.jsonc` add/change/remove events, atomically reload selection state, and publish refreshed workspace/tree information through local and WSL event paths.
- [x] 2.5 Add service and protocol tests proving local and WSL-backed workspace opens and config reloads produce equivalent document visibility and non-fatal diagnostics.

## 3. Renderer Behavior and Diagnostics

- [x] 3.1 Update docs-focused tree pruning to use document visibility classification, omit empty branches, and leave full file-tree behavior unchanged.
- [x] 3.2 Add a user-visible workspace configuration warning that identifies `livedocs.jsonc` and presents its structured parse or validation error.
- [x] 3.3 Add renderer tests for configured include/exclude behavior, default dot-directory hiding, explicit hidden-document inclusion, config warning display, and unaffected full-tree access.

## 4. End-to-End Verification and Documentation

- [x] 4.1 Add end-to-end fixtures and tests for absent, valid, invalid, edited, and removed `livedocs.jsonc` files, including a dot-prefixed skills directory.
- [x] 4.2 Document the root file location, JSONC syntax, `docs.include`/`docs.exclude` schema, matching precedence, defaults, examples, and invalid-config fallback in the user-facing README or configuration guide.
- [x] 4.3 Run affected package tests, type checking, linting, and desktop end-to-end tests; resolve regressions and confirm no change to source indexing or full file-tree visibility.
