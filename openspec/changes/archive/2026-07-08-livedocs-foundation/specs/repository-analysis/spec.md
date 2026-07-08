## ADDED Requirements

### Requirement: Source indexing
The application SHALL build and persist an index of the workspace's source files (paths, languages, exported symbols where extractable) in local storage, and SHALL keep the index current as files change.

#### Scenario: Initial index build
- **WHEN** a workspace is opened for the first time
- **THEN** the application builds a source index in the background without blocking document reading

#### Scenario: Incremental update
- **WHEN** a source file changes after the initial index is built
- **THEN** only the affected entries are re-indexed rather than rebuilding the whole index

### Requirement: Git integration
The application SHALL read Git metadata from the workspace repository, including current branch, recent commits, and per-file change history, for use in views and generated documentation.

#### Scenario: Recent changes available
- **WHEN** the workspace is a Git repository
- **THEN** the application can display recent commits with author, date, message, and changed files

#### Scenario: Non-Git workspace
- **WHEN** the workspace is not a Git repository
- **THEN** Git-dependent features are disabled gracefully and all other features continue to work

### Requirement: Dependency analysis
The application SHALL extract project dependencies from recognized manifest files (at minimum `package.json`) and internal module relationships from imports where supported, producing data consumable by generated documentation.

#### Scenario: Manifest dependencies extracted
- **WHEN** the workspace contains a recognized dependency manifest
- **THEN** the analysis produces the list of direct dependencies with versions

#### Scenario: Module graph for supported languages
- **WHEN** the workspace contains source in a supported language (at minimum TypeScript/JavaScript)
- **THEN** the analysis produces an internal import graph between modules

### Requirement: Repository search
The application SHALL provide search across the workspace covering document content and indexed source, returning results the user can open directly.

#### Scenario: Full-text search
- **WHEN** the user searches for a term that appears in documents or source files
- **THEN** matching results are listed with file path and context, and selecting a result opens the file

#### Scenario: Search stays current
- **WHEN** a file containing a previous search hit is deleted or edited
- **THEN** subsequent searches reflect the updated content
