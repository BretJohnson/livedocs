## Why

LiveDocs currently decides which Markdown documents to display using fixed repository ignore behavior, so workspace owners cannot tailor documentation discovery to their repository. A root `livedocs.jsonc` file provides a versionable, comment-friendly place to control document visibility while safer defaults prevent hidden tool and skill directories from cluttering the docs view.

## What Changes

- Load an optional `livedocs.jsonc` configuration file from the root of each opened workspace, for both local and WSL-backed workspaces.
- Add document include and exclude glob configuration that determines which Markdown files appear as LiveDocs documents.
- Exclude documentation beneath any directory whose name starts with `.` by default.
- Allow explicit configured include patterns to opt documents back into visibility, including documents beneath dot-prefixed directories.
- Define predictable validation and error behavior for malformed or unsupported configuration without preventing the workspace from opening.
- Refresh document visibility when the root configuration file changes.

## Capabilities

### New Capabilities

- `workspace-configuration`: Defines discovery, JSONC parsing, validation, defaults, and live reload behavior for the root `livedocs.jsonc` file.

### Modified Capabilities

- `workspace-management`: Makes the document-focused workspace view honor configured include/exclude globs and the default exclusion of dot-prefixed directories.

## Impact

- Affects workspace opening and file-change handling in the shared Node workspace service used by local and WSL-backed workspaces.
- Affects document discovery/tree construction and potentially document search queries, while leaving general source indexing governed by existing repository ignore rules.
- Introduces a typed configuration model, JSONC parsing/validation, glob matching, tests, and user-facing diagnostics for invalid configuration.
