## Purpose

Define launching WSL workspaces in the native Windows LiveDocs app, connecting to a WSL workspace agent, supporting native Windows UI development from WSL source, and publishing Windows launch integration.

## Requirements

### Requirement: Launch WSL workspaces in the native Windows app
LiveDocs SHALL provide a WSL-side launcher command that opens a WSL workspace in the native Windows LiveDocs application while preserving the selected WSL distro and POSIX workspace path.

#### Scenario: Launch current WSL directory
- **WHEN** the user runs `livedocs .` from inside a WSL distro
- **THEN** the native Windows LiveDocs application opens or focuses with the current WSL directory as the active workspace

#### Scenario: Launch explicit WSL path
- **WHEN** the user runs the WSL launcher with an explicit POSIX path inside the distro
- **THEN** the native Windows LiveDocs application receives the distro name and resolved POSIX path for that workspace

#### Scenario: Missing Windows app
- **WHEN** the user runs the WSL launcher and no compatible Windows LiveDocs installation can be found
- **THEN** the launcher reports an actionable error without starting a WSL GUI instance

### Requirement: Connect Windows UI to WSL workspace agent
For WSL-backed workspaces, LiveDocs SHALL run repository and workspace operations in a WSL agent process and SHALL communicate between the native Windows app and the agent through a versioned local protocol.

#### Scenario: Agent starts for WSL workspace
- **WHEN** the Windows app receives a request to open a WSL workspace
- **THEN** it starts or reuses a compatible agent process inside the requested WSL distro

#### Scenario: Protocol version mismatch
- **WHEN** the Windows app connects to a WSL agent with an incompatible protocol version
- **THEN** the workspace open fails with a clear compatibility error and no repository files are modified

#### Scenario: Agent exits unexpectedly
- **WHEN** the WSL agent exits while a WSL workspace is active
- **THEN** the Windows app reports the disconnected state and stops sending workspace operations until reconnection succeeds

### Requirement: Support native Windows UI development from WSL source
LiveDocs SHALL provide a development workflow that allows source and workspace services to run from WSL while the desktop UI is launched as a native Windows Electron process.

#### Scenario: Start native Windows dev UI from WSL
- **WHEN** a developer runs the documented native-Windows dev command from WSL
- **THEN** LiveDocs launches the Windows Electron UI and connects it to the WSL-built renderer and WSL workspace agent

#### Scenario: Keep WSLg dev path available
- **WHEN** a developer runs the existing Linux Electron dev command under WSL
- **THEN** the existing WSLg-based dev path remains available unless explicitly removed by a later change

### Requirement: Publish Windows app with WSL launch integration
The published Windows LiveDocs application SHALL be installable as a Windows app and SHALL register a launch mechanism that WSL launchers can invoke.

#### Scenario: Installed app handles WSL launch request
- **WHEN** the installed Windows app receives a WSL launch request from the launcher
- **THEN** it opens or focuses one LiveDocs instance and opens the requested WSL workspace

#### Scenario: Second launch reuses running app
- **WHEN** the Windows app is already running and the WSL launcher requests another workspace
- **THEN** the running app handles the request instead of starting an unrelated second UI session
