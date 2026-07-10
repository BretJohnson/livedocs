## ADDED Requirements

### Requirement: Analyze repositories inside WSL for WSL-backed workspaces
For WSL-backed workspaces, LiveDocs SHALL perform repository indexing, dependency analysis, import analysis, and search indexing inside the WSL workspace agent using the POSIX workspace path.

#### Scenario: Initial WSL index build
- **WHEN** a WSL-backed workspace is opened for the first time
- **THEN** the WSL agent builds the source index in the background without blocking document reading in the Windows UI

#### Scenario: Incremental WSL index update
- **WHEN** a source file changes inside a WSL-backed workspace after the initial index is built
- **THEN** the WSL agent re-indexes only the affected entries and reports the updated index status to the Windows UI

#### Scenario: WSL search results
- **WHEN** the user searches while a WSL-backed workspace is active
- **THEN** search executes against the WSL agent's workspace index and returns workspace-relative paths that the Windows UI can open

### Requirement: Run Git integration inside WSL for WSL-backed workspaces
For WSL-backed workspaces, LiveDocs SHALL read Git metadata by running Git from inside the selected WSL distro against the POSIX workspace path.

#### Scenario: WSL Git overview
- **WHEN** the active WSL-backed workspace is a Git repository
- **THEN** the Windows UI can display branch and recent commit data returned by the WSL agent

#### Scenario: WSL Git file history
- **WHEN** the user requests history for a file in a WSL-backed workspace
- **THEN** the WSL agent returns the file history using the workspace-relative POSIX path

#### Scenario: WSL Git worktree subdirectory
- **WHEN** the active WSL-backed workspace is a subdirectory inside a larger Git worktree
- **THEN** the Windows UI can display branch data from the containing worktree
- **AND** recent commits, file history, and recent-change diffs are scoped to files inside the opened workspace
- **AND** returned commit file paths are workspace-relative where possible

#### Scenario: Missing Git in WSL
- **WHEN** Git is unavailable inside the selected WSL distro
- **THEN** Git-dependent features are disabled gracefully and non-Git repository analysis continues

### Requirement: Keep WSL analysis storage inside WSL
For WSL-backed workspaces, LiveDocs SHALL store repository indexes, generated artifact caches, and analysis metadata in the WSL agent's data directory rather than the Windows app reading or writing the WSL repository through Windows filesystem adapters.

#### Scenario: Reopen WSL workspace
- **WHEN** the user reopens a WSL-backed workspace previously loaded by the same WSL agent installation
- **THEN** the WSL agent restores existing indexes and caches for that distro/path identity

#### Scenario: Native module isolation
- **WHEN** the WSL agent opens its SQLite stores for a WSL-backed workspace
- **THEN** it uses Linux-compatible native modules installed in WSL and does not require the Windows Electron process to load those modules
