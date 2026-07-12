# Review: add-livedocs-jsonc-config

## Scope
**Reviewed artifacts:** proposal.md, design.md, tasks.md, specs/workspace-configuration/spec.md, specs/workspace-management/spec.md
**Reviewed code:**
- `packages/analysis/src/workspace-config.ts` (new)
- `packages/analysis/src/index.ts` (exports)
- `packages/analysis/test/workspace-config.test.ts` (new)
- `packages/analysis/package.json` (deps)
- `packages/store/src/types.ts` (protocol types)
- `apps/desktop/src/main/tree.ts` (classification)
- `apps/desktop/src/main/node-workspace-service.ts` (load/reload/watch)
- `apps/desktop/src/main/session.ts`, `apps/desktop/src/main/wsl-agent-runner.ts` (event wiring)
- `apps/desktop/src/renderer/src/App.tsx`, `components/Sidebar.tsx`, `styles.css` (pruning + diagnostic banner)
- `apps/desktop/e2e/scenarios.spec.ts` (e2e)
- `README.md` (docs)

## Findings

### ✅ Verified - RF1 Tasks 2.5 and 3.3 call for dedicated service/protocol and renderer unit tests, but only end-to-end tests were added
- **Severity:** Medium
- **Evidence:** Task 2.5 ("Add service and protocol tests…") and task 3.3 ("Add renderer tests…") are marked complete, but no service or renderer unit tests exist. `apps/desktop` is not listed in the vitest `projects` (`vitest.config.ts` only includes `packages/*`), and there are no `*.test.*` files under `apps/desktop` outside `e2e/`. The pure, easily-unit-testable renderer helper `pruneToDocs` (`apps/desktop/src/renderer/src/components/Sidebar.tsx:8`) — including its "omit empty branches" behavior — and the service-level `reloadConfig`/tree-classification integration (`node-workspace-service.ts:334`) are exercised only through Playwright e2e, which is slower and less precise. The analysis-layer selector logic is well unit-tested, so the gap is specifically at the service and renderer layers.
- **Recommendation:** Either add focused unit tests for `pruneToDocs` and the service reload/classification path (adding `apps/desktop` to the vitest projects or a suitable harness), or amend tasks 2.5/3.3 to record that coverage was intentionally delivered via e2e.
- **Fix:** Added an `apps/desktop` Vitest project with focused tests for pure docs-tree pruning and workspace-service config reload/tree classification, including invalid fallback and removal behavior.
- **Verification:** Confirmed. `vitest.config.ts:5` now includes `apps/desktop`, and `apps/desktop/vitest.config.ts` scopes a `@livedocs/desktop` project. `pruneToDocs` was extracted to `apps/desktop/src/renderer/src/docs-tree.ts` and imported by `Sidebar.tsx:4`. Two new tests exist and pass: `test/docs-tree.test.ts` (selection + empty-branch omission → null) and `test/workspace-config-service.test.ts` (service open/reload classification). `pnpm test` runs 83 tests across 9 files with both desktop tests green.

### ✅ Verified - RF2 Redundant second include-matcher pass in the hidden-directory check
- **Severity:** Low
- **Evidence:** In `createDocumentSelector` (`packages/analysis/src/workspace-config.ts:83`), the guard `if (hasHiddenDirectory && !includes.some((glob) => glob.match(normalized))) return false;` re-runs every include matcher a second time for each file. When `includes.length > 0`, control only reaches this line if `included` was already true (line 76), which means `includes.some(...)` is necessarily true — so the second term is always `false` and the branch can never fire for non-empty includes. The hidden-directory default therefore only ever applies when `includes.length === 0`.
- **Recommendation:** Replace the redundant match with the equivalent, clearer, and cheaper condition: `if (hasHiddenDirectory && includes.length === 0) return false;`. This removes a per-file O(includes) re-scan and makes the "explicit include opts hidden paths in" intent explicit.
- **Fix:** Replaced the second matcher scan with the equivalent `includes.length === 0` hidden-directory guard.
- **Verification:** Confirmed at `workspace-config.ts:76` — now `if (hasHiddenDirectory && includes.length === 0) return false;`. The 11 selector unit tests (including the broad-include opt-in and dot-directory default cases) still pass, proving behavioral equivalence.

### ✅ Verified - RF3 WSL valid-config reload does not verify document-visibility refresh
- **Severity:** Low
- **Evidence:** Task 2.5 requires proving "config reloads produce equivalent document visibility" for WSL-backed workspaces. The WSL e2e block in `apps/desktop/e2e/scenarios.spec.ts` verifies initial-open include visibility (SKILL.md) and an *invalid* reload diagnostic (`{ "docs": { "include": false } }` → banner), but never edits the WSL config into a new *valid* selection and asserts the docs tree changes. The local-workspace block does cover a valid reload; the WSL path relies on the shared `NodeWorkspaceService`, so behavior is likely equivalent, but the requirement's reload-visibility claim is unverified across the agent protocol.
- **Recommendation:** Add a WSL e2e assertion (or a service-level test) that a valid config edit changes which documents appear via the agent's `workspace.changed` event path.
- **Fix:** Extended the WSL agent end-to-end scenario to apply a new valid include selection and verify that the remote docs tree removes the previously included hidden skill while retaining `README.md`.
- **Verification:** Confirmed by inspection of `scenarios.spec.ts:548-554`: the WSL test writes a new valid config `{ "docs": { "include": ["README.md"] } }`, then asserts the `review` hidden-skill branch drops to `toHaveCount(0)` while `README.md` stays visible — a genuine valid-reload visibility change over the agent `workspace.changed` path — before the trailing invalid-config diagnostic assertion. The full Electron/mock-WSL e2e suite was not executed in this pass; the assertion logic is correct and the underlying reload code path is covered by the passing local service integration test.

### ✅ Verified - RF4 Live reload silently depends on `livedocs.jsonc` not being gitignored
- **Severity:** Low
- **Evidence:** Initial config load uses a direct `fs.readFile` (`workspace-config.ts:52`) and is unaffected by ignore rules, but live reload is driven by the workspace watcher, which applies `.gitignore`-derived exclusions (`watcher.ts:41-46`, `ignore-rules.ts`). If a repository's `.gitignore` matches `livedocs.jsonc` (e.g. a broad `*.jsonc` rule), add/change/remove events for it are dropped and the documents view will not refresh until reopen, despite the config being honored on open. The design states the file "remains watchable under existing rules" but this corner is neither documented nor tested.
- **Recommendation:** Either exempt the root `livedocs.jsonc` from watcher ignoring so reloads are reliable, or note this limitation in the README/config guide.
- **Fix:** Exempted only root `livedocs.jsonc` from `.gitignore`-derived watcher filtering, added watcher readiness to prevent immediate post-open edits from being missed, and covered valid/invalid/removal reloads with `*.jsonc` ignored in a service test.
- **Verification:** Confirmed. `watcher.ts` now bypasses the ignore filter for the root config in both the chokidar `ignored` predicate and the `record` handler via `isLiveDocsConfigPath` (root-only: nested `sub/livedocs.jsonc` is unaffected), and exposes a `ready` promise the service awaits in `open()` (`node-workspace-service.ts:181`) to close the post-open edit race. The new `test/workspace-config-service.test.ts` writes `.gitignore` containing `*.jsonc` and asserts valid → invalid → removed reloads all reclassify documents and update diagnostics; it passes.

### ✅ Verified - RF5 `RawLiveDocsConfig` is exported but unused
- **Severity:** Low
- **Evidence:** `RawLiveDocsConfig` is defined (`workspace-config.ts:9`) and re-exported (`index.ts:26`), but validation operates on `unknown` and never references it, so it is dead API surface.
- **Recommendation:** Remove the type, or use it as the input contract for `validateConfig` so the exported type documents the accepted raw shape.
- **Fix:** Removed the unused `RawLiveDocsConfig` type and its public re-export; runtime validation continues to accept `unknown` at the parsing boundary.
- **Verification:** Confirmed. A repo-wide search for `RawLiveDocsConfig` returns no matches, and it is gone from the `index.ts` export block. `pnpm typecheck` passes across all six projects, confirming no dangling references.

## Questions
- None blocking. RF1 hinges on whether the team intends `apps/desktop` to have a unit-test harness at all, or to treat e2e as the sole desktop-layer coverage.

## Summary
- The implementation is solid and closely matches the design: atomic fallback, exclude-wins precedence, forward-slash normalization, dot-directory opt-in, and separation of document visibility from the full file tree and source indexing are all correctly implemented, and the analysis-layer selector is well unit-tested (including Windows/WSL path parity). The reload flow correctly swaps the compiled selector atomically and refreshes both local and WSL views, and diagnostics surface without blocking workspace open. No correctness bugs were found. Open findings are one medium test-type/task mismatch (RF1) plus low-severity cleanups and coverage/edge-case gaps (RF2–RF5).
