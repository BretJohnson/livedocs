## Why

LiveDocs currently treats SQLite migration versions as both schema history and compatibility policy, so changing an already-released schema without an append-only migration can leave existing databases structurally incompatible with current queries. While the app is early and its local data is disposable, it should be possible to intentionally reset incompatible databases instead of maintaining unnecessary data-preserving migrations.

## What Changes

- Add independent database compatibility epochs and migration versions for both the app-global database and per-workspace databases.
- Recreate a database from its current schema when its stored compatibility epoch differs from the epoch supported by the running build; continue applying ordinary forward migrations when the epoch matches.
- Give app and workspace databases separate epoch constants so cache-heavy workspace databases can be invalidated independently from app settings and recents.
- Define safe reset behavior for the main database file and its SQLite WAL/SHM companions, with observable logging and automatic workspace reindexing after reset.
- **BREAKING**: Establish the initial app-database epoch using the schema without `recent_workspaces.label`; existing app databases from the pre-epoch schema are recreated, intentionally discarding recents, AI settings, and encrypted API-key blobs.
- Address review findings RF5 and RF6 by removing the dead label column without an append-only column-drop migration while ensuring databases containing the released v2 schema cannot reach the incompatible INSERT path.

## Capabilities

### New Capabilities

- `database-schema-lifecycle`: Defines compatibility epochs, migration versions, destructive database recreation, and independent lifecycle policy for app and workspace databases.

### Modified Capabilities

- None.

## Impact

- Affects `packages/store` database opening, migrations, app-store writes, workspace-store opening, and migration/reset tests.
- Affects Electron startup behavior because an incompatible `app.db` reset removes stored recents, AI configuration, and encrypted credentials.
- Affects workspace startup because an incompatible per-workspace database is rebuilt and then repopulated by the normal indexing flow.
- Does not change repository files or require a new runtime dependency.
