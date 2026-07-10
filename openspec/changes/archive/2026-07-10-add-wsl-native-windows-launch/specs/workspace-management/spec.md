## ADDED Requirements

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
