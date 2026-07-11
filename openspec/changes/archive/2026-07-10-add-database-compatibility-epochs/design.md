## Context

LiveDocs has one app-global SQLite database (`app.db`) and one SQLite database per workspace. Both use `PRAGMA user_version` to track append-only migrations. The app schema's released v2 migration created a required `recent_workspaces.label` column. RF5 removed that dead column and its writes by editing v2 in place, but RF6 demonstrated that an existing v2 database retains the required column and rejects the new INSERT.

Most workspace data is rebuildable index/cache state. App data is also acceptable to lose during the current single-user development phase, although resetting it additionally removes AI configuration and encrypted API-key blobs. The design therefore permits intentional destructive compatibility changes while keeping ordinary data-preserving migrations available.

## Goals / Non-Goals

**Goals:**

- Track schema compatibility independently from forward migration progress.
- Allow app and workspace schemas to abandon backward compatibility independently.
- Reset legacy or epoch-incompatible databases before current code queries them.
- Make the released-v2-to-no-label transition safe by intentionally resetting the old app database.
- Test both fresh creation and the actual legacy database path that RF6 found.

**Non-Goals:**

- Preserve recents, settings, credentials, generated artifacts, or cached data across an epoch mismatch.
- Provide user-facing backup, export, or reset confirmation UI during the early single-user phase.
- Automatically recover a database created by a newer build within the same epoch.
- Change where SQLite files are stored or write database state into repositories.

## Decisions

### Persist an epoch separately from `PRAGMA user_version`

Each database will contain a small, stable bootstrap metadata table holding its compatibility epoch. `PRAGMA user_version` remains the migration version. Database-opening code reads the epoch before creating an `AppStore` or `WorkspaceStore` and before running application SQL.

An absent epoch in a pre-existing, non-empty database means "legacy/incompatible," not epoch zero. A missing database is initialized directly with the supported epoch. This distinction prevents a fresh database from being reported as reset while ensuring every pre-epoch database takes the deliberate recreation path.

Alternative considered: overload `user_version`. Rejected because it cannot independently express "discard this migration history" and "apply the next compatible migration."

Alternative considered: use only `PRAGMA application_id`. Rejected because application identity and schema compatibility are separate concerns, and app/workspace database kind plus epoch are clearer as explicit metadata.

### Use separate constants and a shared opening helper

The store package will define `APP_DB_COMPATIBILITY_EPOCH` and `WORKSPACE_DB_COMPATIBILITY_EPOCH`, initially `1`. A shared helper will own the lifecycle sequence: detect whether the file existed, open only for bootstrap inspection, compare epoch, close, remove the main/WAL/SHM files when incompatible, reopen, initialize metadata, validate migration direction, and run migrations.

The helper accepts the database kind, supported epoch, migration list, and diagnostic hook or message context. Keeping reset mechanics common avoids subtle divergence while the constants preserve independent policy.

Alternative considered: duplicate reset logic in `AppStore.open` and `openWorkspaceDb`. Rejected because WAL/SHM cleanup, future-version handling, and test expectations must remain identical.

### Scope migration histories to an epoch

Migrations are append-only within an epoch. Bumping an epoch explicitly permits replacing or squashing the migration list because all databases from a different or missing epoch are discarded before the list runs. Migration versions can restart at 1 for a new epoch.

For the initial epoch introduction, the app migration history becomes a clean baseline schema without `recent_workspaces.label`. The released v2 schema has no epoch metadata, so it is reset rather than upgraded. The workspace epoch is also initialized to 1; existing pre-epoch workspace databases are disposable and will be rebuilt.

Alternative considered: restore released v2 and add a v3 `DROP COLUMN`. Rejected for this change because the explicit goal is to exercise the new opt-out from backward compatibility, and preserving current single-user local state is unnecessary.

### Refuse same-epoch database downgrades

If the stored epoch matches but `user_version` is newer than the highest known migration, opening fails without modification. A same-epoch version difference normally calls for forward migration; silently deleting a newer database during an application downgrade would turn a compatibility mechanism into unexpected data loss.

### Reset before exposing a store

The opening helper completes epoch validation, reset, metadata initialization, and migrations before returning a `Database`. This guarantees `touchRecentWorkspace` cannot execute against the released v2 `label NOT NULL` schema. It also means reset failures abort startup/workspace opening with a focused error.

Diagnostics include database kind and epoch transition but not paths containing sensitive workspace names unless existing logging policy already permits them, and never include row contents, settings, or credentials.

## Risks / Trade-offs

- **App epoch resets remove encrypted API keys and configuration** → Keep app and workspace epochs separate, document app epoch bumps, and use an ordinary migration whenever preserving app state is worthwhile.
- **A reset can fail because SQLite files are locked** → Close the connection before removal, handle the main file plus `-wal` and `-shm`, and fail opening clearly rather than using the old schema.
- **Editing migrations remains dangerous without an epoch bump** → Document that migration histories are append-only within an epoch and add tests that seed the prior epoch/legacy layout.
- **All existing workspace caches reset on initial adoption** → Treat the initial workspace epoch as an intentional one-time invalidation; normal indexing repopulates the cache.
- **A crash during file replacement can leave partial files** → The next open repeats compatibility inspection/reset; no store is returned until a fresh schema is valid.

## Migration Plan

1. Introduce the shared epoch-aware database-opening helper and independent epoch constants.
2. Initialize both compatibility epochs to `1`; treat existing databases without epoch metadata as incompatible legacy databases.
3. Define the epoch-1 app schema as a fresh baseline without `recent_workspaces.label` and keep labels derived on read.
4. Open a fixture containing the released app v2 schema and verify it is reset before recording a recent workspace.
5. Verify fresh, matching-epoch migration, mismatched-epoch reset, WAL/SHM cleanup, future-version refusal, and independent app/workspace epoch behavior.

Rollback to a build without epoch support is not data-compatible. During this early phase, rollback consists of deleting the newly created local databases and allowing the older build to recreate its expected schema; no data restoration is promised.

## Open Questions

- None for the initial implementation. A future multi-user release should revisit whether app-database epoch resets require backup, selective settings preservation, or user confirmation.
