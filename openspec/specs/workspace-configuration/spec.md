## Purpose

Define workspace-root LiveDocs configuration, document visibility glob behavior, safe defaults, diagnostics, and live reload behavior.

## Requirements

### Requirement: Load workspace-root LiveDocs configuration
When a workspace is opened, LiveDocs SHALL look only for `livedocs.jsonc` at the workspace root and, when present, SHALL parse it as JSON with line comments, block comments, and trailing commas supported. The same behavior SHALL apply to local and WSL-backed workspaces using the workspace's native filesystem execution context.

#### Scenario: Root configuration exists
- **WHEN** a workspace containing a valid root `livedocs.jsonc` is opened
- **THEN** LiveDocs loads that configuration before determining which files are displayed as documents

#### Scenario: Configuration is absent
- **WHEN** a workspace without a root `livedocs.jsonc` is opened
- **THEN** LiveDocs opens the workspace using the default document visibility behavior

#### Scenario: Nested configuration exists
- **WHEN** a `livedocs.jsonc` file exists below the workspace root but no root configuration exists
- **THEN** LiveDocs ignores the nested file as configuration

#### Scenario: WSL-backed configuration exists
- **WHEN** a WSL-backed workspace containing a root `livedocs.jsonc` is opened
- **THEN** the WSL workspace agent reads and applies the configuration from the POSIX workspace root

### Requirement: Configure document visibility with globs
The root configuration SHALL accept optional `docs.include` and `docs.exclude` arrays of workspace-relative glob strings. A Markdown file SHALL be visible as a document only when it satisfies the include selection and does not match an exclude glob. Paths and patterns SHALL use forward-slash workspace-relative semantics on every platform. An omitted or empty `docs.include` SHALL select all recognized Markdown files, and an omitted or empty `docs.exclude` SHALL add no configured exclusions.

#### Scenario: Include selects a subset
- **WHEN** `docs.include` contains `docs/**` and the workspace contains `docs/guide.md` and `notes.md`
- **THEN** `docs/guide.md` is displayed as a document and `notes.md` is not

#### Scenario: Exclude removes an included document
- **WHEN** a Markdown file matches both a `docs.include` glob and a `docs.exclude` glob
- **THEN** the file is not displayed as a document

#### Scenario: Empty glob arrays
- **WHEN** `docs.include` and `docs.exclude` are empty arrays
- **THEN** LiveDocs applies its default Markdown selection and default hidden-directory exclusion

#### Scenario: Platform-independent matching
- **WHEN** the same workspace and configuration are opened as local and WSL-backed workspaces
- **THEN** forward-slash glob patterns select the same workspace-relative document paths

### Requirement: Exclude dot-prefixed directories by default
LiveDocs SHALL, by default, not display Markdown files located at any depth beneath a directory segment whose name starts with `.`. A file beneath such a directory SHALL become eligible when it matches an explicitly configured `docs.include` glob, unless it also matches a configured `docs.exclude` glob. This document visibility default SHALL NOT exclude the directory or its files from the full file tree or otherwise change general source indexing behavior.

#### Scenario: Root hidden directory
- **WHEN** a workspace contains `.agents/skills/review/SKILL.md` and no include glob explicitly matches it
- **THEN** the file is absent from the documents view
- **AND** it remains available according to the existing full-file-tree and indexing rules

#### Scenario: Nested hidden directory
- **WHEN** a workspace contains `docs/.drafts/plan.md` and no include glob explicitly matches it
- **THEN** the file is absent from the documents view

#### Scenario: Explicitly include a hidden document
- **WHEN** `docs.include` explicitly matches `.agents/skills/**/*.md`
- **THEN** matching Markdown files beneath `.agents` are displayed as documents

#### Scenario: Exclude overrides explicit include
- **WHEN** a hidden-directory Markdown file matches both an explicit `docs.include` glob and a `docs.exclude` glob
- **THEN** the file is not displayed as a document

### Requirement: Handle invalid configuration safely
LiveDocs SHALL validate the parsed configuration shape and glob entries. If the root configuration cannot be parsed or validated, LiveDocs SHALL continue opening the workspace with default document visibility and SHALL expose a diagnostic that identifies `livedocs.jsonc` and explains the error.

#### Scenario: Malformed JSONC
- **WHEN** the root `livedocs.jsonc` contains malformed JSONC
- **THEN** the workspace still opens with default document visibility
- **AND** LiveDocs exposes a configuration diagnostic

#### Scenario: Invalid field type
- **WHEN** `docs.include` or `docs.exclude` is not an array of valid glob strings
- **THEN** the workspace still opens with default document visibility
- **AND** LiveDocs exposes a diagnostic describing the invalid field

### Requirement: Reload configuration changes
LiveDocs SHALL reevaluate document visibility when the root `livedocs.jsonc` file is added, changed, or removed while its workspace is open, without requiring the user to reopen the workspace.

#### Scenario: Configuration is edited
- **WHEN** a user changes document globs in the root `livedocs.jsonc`
- **THEN** the documents view refreshes to reflect the new selection

#### Scenario: Configuration is removed
- **WHEN** the root `livedocs.jsonc` is removed while the workspace is open
- **THEN** the documents view returns to default visibility behavior

#### Scenario: Configuration becomes invalid
- **WHEN** a valid root configuration is edited into an invalid configuration
- **THEN** LiveDocs uses default document visibility and exposes a configuration diagnostic

