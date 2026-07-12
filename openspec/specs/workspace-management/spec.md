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
The application SHALL display a navigable tree of the workspace's contents, distinguishing documentation files (Markdown) from source and other files, and SHALL open documents in the reading view when selected. The docs-focused view SHALL include only Markdown files selected by the active workspace's document visibility configuration and defaults, while the full file tree SHALL remain governed by the existing repository path-ignore behavior.

#### Scenario: Select a Markdown document
- **WHEN** the user selects a visible Markdown file in the workspace tree
- **THEN** the application renders it in the reading view

#### Scenario: Documentation-first navigation
- **WHEN** the workspace contains Markdown documents selected by the active document visibility rules
- **THEN** the tree presents them prominently in a docs-focused view while still allowing access to the full file tree

#### Scenario: Hidden document is omitted from docs navigation
- **WHEN** a Markdown file is not selected by the active document visibility rules
- **THEN** the docs-focused view omits that file and any directory branches left empty by its omission
- **AND** the file remains available in the full file tree when existing repository ignore rules permit it

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

### Requirement: Open WSL-backed workspaces
The application SHALL distinguish local workspaces from WSL-backed workspaces. A WSL-backed workspace SHALL be identified by its WSL distro and POSIX workspace path, and workspace operations SHALL preserve that identity.

#### Scenario: Open WSL workspace reference
- **WHEN** the application receives a WSL workspace reference containing a distro and POSIX path
- **THEN** it loads that folder as the active workspace without converting the workspace identity to a Windows UNC path

#### Scenario: Display WSL workspace identity
- **WHEN** a WSL-backed workspace is active
- **THEN** the application displays a user-recognizable workspace label that includes the distro and POSIX path

#### Scenario: Recent WSL workspace
- **WHEN** the user has opened a WSL-backed workspace
- **THEN** the recent workspaces list preserves the workspace kind, distro, POSIX path, name, and last-opened time

### Requirement: Route WSL workspace file operations through the agent
For WSL-backed workspaces, the application SHALL route file tree, document read, accepted edit, file open, and file-change operations through the WSL workspace agent.

#### Scenario: Browse WSL workspace tree
- **WHEN** a WSL-backed workspace is active and the user views the workspace tree
- **THEN** the tree reflects files read by the WSL agent from the POSIX workspace path

#### Scenario: Read WSL document
- **WHEN** the user selects a Markdown document in a WSL-backed workspace
- **THEN** the application renders content returned by the WSL agent for that workspace-relative path

#### Scenario: Apply accepted edit in WSL workspace
- **WHEN** the user accepts an edit for a file in a WSL-backed workspace
- **THEN** the WSL agent applies the edit to the POSIX file path only after validating that the relative path stays inside the workspace

#### Scenario: WSL file change updates UI
- **WHEN** a watched file changes inside a WSL-backed workspace
- **THEN** the WSL agent sends a change event and the Windows app updates affected views without requiring manual refresh
