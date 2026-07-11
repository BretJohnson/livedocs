## 1. Epoch-aware database lifecycle

- [x] 1.1 Add stable compatibility-epoch metadata, independent app/workspace epoch constants initialized to `1`, and helpers to read and initialize the epoch without conflating it with `PRAGMA user_version`.
- [x] 1.2 Implement a shared database-opening path that distinguishes fresh files from legacy files, resets missing or mismatched epochs before exposing the database, and removes the main, `-wal`, and `-shm` files after closing SQLite.
- [x] 1.3 Preserve ordinary ascending migrations for matching epochs and reject same-epoch `user_version` values newer than the current migration list without modifying the database.
- [x] 1.4 Emit reset and failure diagnostics containing database kind and epoch transition without including database contents or credentials.

## 2. Store integration and RF5/RF6 resolution

- [x] 2.1 Route both `AppStore.open` and `openWorkspaceDb` through the shared lifecycle helper using their independent epoch constants.
- [x] 2.2 Replace the app migration history for epoch 1 with a clean baseline schema that omits `recent_workspaces.label`, and keep recent-workspace INSERTs free of the derived label.
- [x] 2.3 Confirm the normal workspace service/indexing path accepts a freshly reset empty workspace database and repopulates derived state.
- [x] 2.4 Update `more-wsl-fixes-review.md` with fix notes for RF5 and RF6 describing the epoch-based non-backward-compatible reset; leave fixes pending independent review verification.

## 3. Lifecycle and regression tests

- [x] 3.1 Test fresh app and workspace database creation with independent stored epochs and migration versions.
- [x] 3.2 Test matching-epoch forward migration and current-version reopening without data loss or repeated migrations.
- [x] 3.3 Seed the released app v2 schema with `user_version = 2` and no epoch, then verify opening resets it, removes `label`, and allows `touchRecentWorkspace` to succeed.
- [x] 3.4 Test explicit epoch mismatch reset, app/workspace epoch independence, reset diagnostics, and cleanup of main/WAL/SHM database files.
- [x] 3.5 Test that a same-epoch future migration version fails clearly and leaves the database intact.
- [x] 3.6 Run the full unit suite, typecheck, and relevant desktop/WSL smoke checks after integration.

## 4. Developer guidance

- [x] 4.1 Document when to add a forward migration versus bump an app or workspace compatibility epoch, including the data each reset discards and the rule that migrations remain append-only within an epoch.
