# Database schema lifecycle

LiveDocs stores one app-global SQLite database and one database per workspace. Each database tracks two independent versions:

- The **compatibility epoch** identifies a schema family. If the stored epoch is missing or differs from the epoch supported by the running build, LiveDocs deletes and recreates that database.
- SQLite `PRAGMA user_version` tracks forward migrations within the current epoch. Migrations are append-only while an epoch remains current.

Use a forward migration when existing data should survive and the old schema can be upgraded reasonably. Bump a compatibility epoch when preserving the old layout would add unjustified complexity and losing that database's contents is acceptable. An epoch bump permits replacing or squashing that epoch's migration history; migration versions may restart at `1`.

The constants are independent:

- `APP_DB_COMPATIBILITY_EPOCH` resets `app.db`. This loses recent workspaces, AI provider/model/base URL settings, and encrypted API-key blobs.
- `WORKSPACE_DB_COMPATIBILITY_EPOCH` resets per-workspace databases. This loses file/search indexes, extracted analysis and Git metadata, generated-artifact cache entries, and AI response cache entries. Normal workspace indexing repopulates derived state.

Do not edit an already-applied migration without also bumping that database kind's compatibility epoch. A matching epoch with an older migration version runs pending migrations. A matching epoch with a newer migration version is treated as an unsupported application downgrade and fails without deleting the database.

On an incompatible epoch, LiveDocs closes SQLite, removes the database plus its `-wal` and `-shm` companions, creates the current schema, and logs the database kind and epoch transition. Store access is not exposed until reset and migration complete successfully.
