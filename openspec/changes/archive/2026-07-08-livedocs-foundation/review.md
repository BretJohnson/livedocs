# Review: livedocs-foundation

## Scope
**Reviewed artifacts:** `proposal.md`, `design.md`, `tasks.md`, and delta specs for `ai-integration`, `diagram-rendering`, `live-doc-generation`, `markdown-rendering`, `repository-analysis`, and `workspace-management`  
**Reviewed code:** root workspace config, `apps/desktop`, `packages/ai`, `packages/analysis`, `packages/generators`, `packages/pipeline`, `packages/store`, README, unit tests, and Electron Playwright specs

## Findings

### ✅ Verified - RF1 API keys can be persisted as plaintext when Electron secure storage is unavailable
- **Severity:** High
- **Evidence:** The AI spec says provider credentials SHALL be stored securely. `apps/desktop/src/main/ai-config.ts:12` documents a fallback to obfuscated plaintext, and `apps/desktop/src/main/ai-config.ts:23` writes `plain:${Buffer.from(apiKey).toString('base64')}` when `safeStorage.isEncryptionAvailable()` is false. This stores recoverable credentials in the app SQLite database despite the README and settings UI promising OS secure storage.
- **Recommendation:** Remove the plaintext persistence fallback. If `safeStorage` is unavailable, do not save the key; surface an unsupported/needs-OS-secret-store state in settings, or require a secure credential backend before enabling cloud providers.
- **Fix:** Removed the `plain:` persistence and read paths in `ai-config.ts`; `storeApiKey` now only writes safeStorage-encrypted values and returns `false` (persisting nothing) when encryption is unavailable. Added `secureStorageAvailable` to `AIConfigView` (dropping the `plaintext` keyStorage state) and updated `SettingsDialog` to warn that cloud keys won't be saved without an OS secret store, steering the user to a local provider. Made the e2e key-save scenario deterministic by launching Electron with `--password-store=basic`.
- **Verification:** Confirmed source now accepts only `enc:` key material and no longer contains a `plain:` read/write path; unencrypted-key grep assertions cover both workspace and app data. `pnpm typecheck`, focused Vitest tests, and `pnpm test:e2e` all pass.

### ✅ Verified - RF2 Directory-only `.gitignore` patterns are not excluded at the directory boundary
- **Severity:** Medium
- **Evidence:** `packages/analysis/src/ignore-rules.ts:27` builds the filter from defaults plus raw `.gitignore` content, but callers pass directory paths without a trailing slash. `packages/analysis/src/indexer.ts:50`, `apps/desktop/src/main/tree.ts:27`, and `packages/analysis/src/watcher.ts:41` all check entries like `secret`, while a common `.gitignore` rule such as `secret/` only matches `secret/` or descendants. The result is that ignored directories can still be traversed, shown as empty tree nodes, and emit `addDir`/`unlinkDir` watcher events, contrary to the ignored-path scenario.
- **Recommendation:** For directory entries and watcher directory paths, check both `rel` and `${rel}/` or expose an `ignoresDirectory()` helper. Add regression tests for a `.gitignore` directory rule such as `secret/` covering the tree, watcher, and indexer walk.
- **Fix:** Added an `ignoresDirectory(rel)` helper on `PathFilter` that checks both `rel` and `${rel}/` (verified against the `ignore` package: `secret/` matches `secret/` but not the bare `secret`). Updated the three callers to use it for directory entries only (`tree.ts`, `indexer.ts` walk), and updated `watcher.ts` to apply it in the chokidar `ignored` predicate when stats indicate a directory plus a belt-and-suspenders guard on `addDir`/`unlinkDir` records so ignored directories are never descended into or emitted. Added regression tests: an `ignoresDirectory` unit test and an indexer full-scan test proving a `secret/` rule excludes the directory (files named `secret` are unaffected).
- **Verification:** Confirmed `tree.ts`, the indexer walk, and watcher directory-event filtering use `ignoresDirectory()`, while file checks still use `ignores()` so file names matching a directory-only rule are unaffected. The analysis regression tests pass, including the `secret/` directory-boundary and full-scan exclusions.

### ✅ Verified - RF3 AI-generated sections stop receiving stale markers when no provider is configured
- **Severity:** Medium
- **Evidence:** `apps/desktop/src/main/generator-host.ts:91` recomputes stored artifact staleness after index updates, but `apps/desktop/src/main/generator-host.ts:97` skips AI generators entirely when `ctx.ai` is absent. A previously generated `architecture-overview` can therefore remain displayed as current after repository inputs change if the user later removes or loses AI configuration. The live-doc-generation spec requires generated sections to be marked stale when their inputs change.
- **Recommendation:** Decouple AI staleness calculation from provider availability. Compute the source-input digest for AI artifacts using indexed repository state and the artifact's stored model/provenance when no active AI service exists, then mark stale even if refresh must still wait for provider configuration.
- **Fix:** Removed the `generator.kind === 'ai' && !ctx.ai` skip in `recomputeStaleness`. Added an optional `modelHint` to `GeneratorContext`; `architecture-overview.inputDigest` now folds `ctx.ai?.model ?? ctx.modelHint ?? null` into the digest, and `recomputeStaleness` passes the artifact's stored `provenance.model` as `modelHint` when no provider is active. AI artifacts are now marked stale on repository-input changes even without a configured provider, while `refreshArtifact`/`getArtifact` still gate the actual regeneration on provider availability (returning `needs-run` when unconfigured).
- **Verification:** Confirmed `recomputeStaleness()` no longer skips AI generators without `ctx.ai`, passes stored `provenance.model` as `modelHint`, and compares the resulting digest to the stored artifact digest while `runAndSave()` still gates actual AI regeneration on provider availability. Generator digest tests, typecheck, and e2e stale-section coverage pass.

## Questions
- None

## Summary
- All previously fixed findings have been verified. Focused unit tests, full typecheck, and the Electron e2e suite pass; no open review findings remain.
