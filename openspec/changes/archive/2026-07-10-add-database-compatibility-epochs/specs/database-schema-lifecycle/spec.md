## ADDED Requirements

### Requirement: Database kinds have independent compatibility epochs
The system SHALL define and persist separate compatibility epochs for the app-global database and per-workspace databases. A compatibility epoch SHALL be independent of the SQLite migration version and SHALL identify a schema family for which the current migration history is valid.

#### Scenario: Workspace epoch changes independently
- **WHEN** the supported workspace-database epoch changes while the app-database epoch remains unchanged
- **THEN** workspace databases are evaluated against the new workspace epoch without invalidating `app.db`

#### Scenario: App epoch changes independently
- **WHEN** the supported app-database epoch changes while the workspace-database epoch remains unchanged
- **THEN** `app.db` is evaluated against the new app epoch without invalidating per-workspace databases

### Requirement: Matching epochs use forward migrations
When a database's stored compatibility epoch matches the epoch supported by the running build, the system SHALL preserve the database and apply pending migrations in ascending migration-version order. Migration versions SHALL be scoped to their compatibility epoch and tracked separately from that epoch.

#### Scenario: Pending migration within the current epoch
- **WHEN** a database stores the supported compatibility epoch and an older migration version
- **THEN** the system applies each pending migration and retains the database's existing data

#### Scenario: Current migration within the current epoch
- **WHEN** a database stores both the supported compatibility epoch and current migration version
- **THEN** the system opens it without recreating it or rerunning migrations

### Requirement: Incompatible epochs trigger database recreation
When an existing database has a missing or different compatibility epoch, the system SHALL close it, remove the database file and its `-wal` and `-shm` companions, create a fresh database at the supported epoch, and apply the current epoch's migrations from the beginning. The reset SHALL occur before application queries or writes use the incompatible schema.

#### Scenario: Legacy database has no epoch
- **WHEN** LiveDocs opens a non-empty database created before compatibility epochs were introduced
- **THEN** the system recreates it at the supported epoch before constructing a store that can issue application queries

#### Scenario: Stored epoch differs
- **WHEN** LiveDocs opens a database whose stored compatibility epoch differs from the supported epoch
- **THEN** the system recreates the database and does not attempt to migrate or query the incompatible schema

#### Scenario: Fresh database
- **WHEN** the target database does not yet exist
- **THEN** the system creates it directly at the supported epoch without treating creation as a destructive reset

### Requirement: Reset behavior is observable and fails safely
The system SHALL emit a diagnostic identifying the database kind and old and new compatibility epochs when it resets an incompatible database. If the incompatible database cannot be closed, removed, recreated, or migrated, opening SHALL fail with a clear error instead of continuing against a partially compatible schema.

#### Scenario: Successful incompatible reset
- **WHEN** an incompatible database is successfully recreated
- **THEN** a diagnostic records its kind and compatibility-epoch transition without exposing database contents or credentials

#### Scenario: Reset cannot complete
- **WHEN** a database file or SQLite companion cannot be removed or the fresh schema cannot be created
- **THEN** store opening fails before application reads or writes are attempted

### Requirement: Future migration versions are not silently destroyed
The system MUST NOT automatically recreate a database solely because its migration version is newer than the highest migration version known to the running build when its compatibility epoch matches. It SHALL fail opening with an explicit unsupported-version error.

#### Scenario: Application downgrade within an epoch
- **WHEN** a database has the supported compatibility epoch but a migration version newer than the running build supports
- **THEN** opening fails without deleting or modifying the database

### Requirement: Initial app epoch removes the stored recent-workspace label
The initial epoch-aware app-database schema SHALL omit `recent_workspaces.label`, and recent-workspace labels SHALL be derived from workspace references on read. A released v2 app database without epoch metadata SHALL be reset before `touchRecentWorkspace` executes, so its former `label TEXT NOT NULL` constraint cannot reject the current INSERT.

#### Scenario: Released v2 app database is opened
- **WHEN** `app.db` contains the released v2 schema, has `user_version = 2`, and has no compatibility epoch
- **THEN** LiveDocs recreates it using the initial epoch-aware schema without the `label` column and a subsequent `touchRecentWorkspace` succeeds

#### Scenario: Fresh app database stores recents
- **WHEN** a fresh epoch-aware app database records a recent workspace
- **THEN** the row stores workspace identity fields, name, and last-opened time but no display label

### Requirement: Workspace reset is recoverable through indexing
After an incompatible per-workspace database is recreated, the system SHALL allow the existing workspace indexing flow to repopulate derived file, search, analysis, Git, generator, and AI-cache state as applicable.

#### Scenario: Workspace database epoch changes
- **WHEN** a workspace database is recreated because its compatibility epoch changed
- **THEN** opening the workspace proceeds with an empty valid store and normal indexing can repopulate its derived state
