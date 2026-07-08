## Purpose

Define local workspace opening, recent workspace restoration, document/file browsing, and file-system change handling.

## Requirements

### Requirement: Open a local repository as a workspace
The application SHALL allow the user to open a local folder as a workspace. Opening a workspace SHALL initialize local storage (indexes, caches, metadata) scoped to that workspace and restore it on subsequent opens.

#### Scenario: Open a folder
- **WHEN** the user selects a local folder via the open-workspace action
- **THEN** the application loads the folder as the active workspace and displays its document and file tree

#### Scenario: Reopen a known workspace
- **WHEN** the user reopens a folder that was previously loaded as a workspace
- **THEN** the application restores existing indexes and caches instead of rebuilding from scratch

#### Scenario: Recent workspaces
- **WHEN** the user launches the application after having opened at least one workspace
- **THEN** the application offers a list of recently opened workspaces to choose from

### Requirement: Browse workspace documents and files
The application SHALL display a navigable tree of the workspace's contents, distinguishing documentation files (Markdown) from source and other files, and SHALL open documents in the reading view when selected.

#### Scenario: Select a Markdown document
- **WHEN** the user selects a Markdown file in the workspace tree
- **THEN** the application renders it in the reading view

#### Scenario: Documentation-first navigation
- **WHEN** the workspace contains Markdown documents
- **THEN** the tree presents them prominently (e.g., a docs-focused view) while still allowing access to the full file tree

### Requirement: React to file-system changes
The application SHALL watch the active workspace for file changes and update affected views and indexes without requiring a manual refresh.

#### Scenario: Edited document refreshes
- **WHEN** a Markdown file currently displayed in the reading view is modified on disk
- **THEN** the rendered view updates to reflect the new content

#### Scenario: Added and removed files update the tree
- **WHEN** files are created or deleted inside the workspace
- **THEN** the workspace tree reflects the change and the repository index is scheduled for update

#### Scenario: Ignored paths are excluded
- **WHEN** changes occur under commonly ignored paths (e.g., `.git/`, `node_modules/`, build output)
- **THEN** the watcher does not trigger re-indexing or view updates for those paths
