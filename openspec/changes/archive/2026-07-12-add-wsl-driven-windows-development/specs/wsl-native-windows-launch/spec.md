## MODIFIED Requirements

### Requirement: Support native Windows UI development from WSL source
LiveDocs SHALL provide a WSL-driven development workflow in which a repository stored in WSL remains the authoritative source, the WSL agent is built and installed with Linux dependencies, and the desktop shell is built and launched as a native Windows Electron process from an isolated Windows build mirror. The workflow MUST NOT share `node_modules` or native build artifacts across the WSL and Windows environments.

#### Scenario: Start native Windows dev UI from WSL
- **WHEN** a developer runs the documented native-Windows development command from a LiveDocs checkout inside WSL
- **THEN** LiveDocs builds and installs the WSL agent from that checkout, synchronizes build inputs to an isolated Windows mirror, starts the Windows Electron development process, and opens the original WSL workspace through the agent

#### Scenario: Source change reloads the Windows shell
- **WHEN** a relevant source file is added, changed, or removed in the authoritative WSL checkout while the native-Windows development command is running
- **THEN** LiveDocs reflects that change in the Windows mirror so the Windows Electron/Vite development process can rebuild or reload it
- **AND** generated output, dependency directories, repository metadata, and other excluded paths are not synchronized

#### Scenario: Preserve environment-specific dependencies
- **WHEN** the WSL agent and Windows shell are built from the same WSL-driven session
- **THEN** Linux Node-ABI dependencies remain in the WSL checkout or WSL deployment and Windows Electron-ABI dependencies remain in the Windows mirror
- **AND** neither environment modifies or consumes the other environment's `node_modules`

#### Scenario: Reuse a compatible Windows mirror
- **WHEN** the development command is run again for the same WSL checkout and its existing Windows mirror is compatible
- **THEN** LiveDocs reuses the mirror and valid Windows dependencies while synchronizing current build inputs before launch

#### Scenario: Refresh incompatible Windows dependencies
- **WHEN** package manifests, the lockfile, the required Node or pnpm version, or other dependency inputs make the cached Windows installation incompatible
- **THEN** LiveDocs refreshes the Windows dependencies before building or launching the shell

#### Scenario: Build Windows production output from WSL
- **WHEN** a developer runs the documented WSL-driven Windows build command
- **THEN** LiveDocs synchronizes the WSL source and produces the native Windows production build in the Windows environment without requiring a user-managed Windows checkout

#### Scenario: Build Windows installer from WSL
- **WHEN** a developer runs the documented WSL-driven Windows distribution command
- **THEN** LiveDocs synchronizes the WSL source and invokes Windows packaging to produce the configured Windows installer

#### Scenario: Missing Windows prerequisite
- **WHEN** WSL interoperability, Windows Node.js, the required Windows pnpm version, or another required Windows build prerequisite is unavailable
- **THEN** the command exits with an actionable diagnostic identifying the missing prerequisite and does not report a successful build or launch

#### Scenario: Development session stops
- **WHEN** the developer interrupts the WSL-driven native-Windows development command or its Windows child process exits
- **THEN** LiveDocs stops session-owned synchronization and build processes and reports the resulting exit status to the WSL terminal

#### Scenario: Keep WSLg dev path available
- **WHEN** a developer runs the existing Linux Electron development command under WSL
- **THEN** the existing WSLg-based development path remains available unless explicitly removed by a later change

