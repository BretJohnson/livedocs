import { mkdtempSync, rmSync, writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';

const E2E_DIR = import.meta.dirname;
const FIXTURE = path.join(E2E_DIR, 'fixtures', 'sample-repo');
const MAIN = path.join(E2E_DIR, '..', 'out', 'main', 'index.js');

function launchEnv(extra: Record<string, string>): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  return { ...env, LIVEDOCS_NO_SANDBOX: '1', ...extra };
}

test.describe.serial('spec scenarios (fixture workspace, mock AI)', () => {
  let app: ElectronApplication;
  let page: Page;
  let userData: string;

  test.beforeAll(async () => {
    userData = mkdtempSync(path.join(tmpdir(), 'livedocs-e2e-sc-'));
    app = await _electron.launch({
      args: [MAIN, '--no-sandbox'],
      env: launchEnv({
        LIVEDOCS_WORKSPACE: FIXTURE,
        LIVEDOCS_USER_DATA: userData,
        LIVEDOCS_AI_MOCK: '1',
      }),
    });
    page = await app.firstWindow();
    await expect(page.locator('.index-status')).toHaveText(/files indexed/, { timeout: 30_000 });
  });

  test.afterAll(async () => {
    await app?.close();
    rmSync(userData, { recursive: true, force: true });
  });

  async function openDoc(name: string, expectedH1: string): Promise<void> {
    await page.locator('.sidebar-tabs button', { hasText: 'Docs' }).click();
    await page
      .locator('.sidebar')
      .getByRole('button', { name: new RegExp(name) })
      .click();
    await expect(page.locator('.doc-article h1')).toHaveText(expectedH1);
  }

  test('invalid mermaid shows an inline error with source; document still renders', async () => {
    await openDoc('edge-cases\\.md', 'Edge Cases');
    const error = page.locator('.diagram-error');
    await expect(error).toBeVisible({ timeout: 30_000 });
    await expect(error.locator('pre')).toContainText('not(((valid mermaid');
    await expect(page.locator('.doc-article')).toContainText('Text after the broken pieces');
  });

  test('unregistered diagram-like language falls back to a plain code block', async () => {
    await expect(page.locator('.doc-article .code-block[data-lang="plantuml"]')).toContainText(
      'Alice -> Bob',
    );
  });

  test('unknown generator renders an inline error naming available generators', async () => {
    const section = page.locator('.generated-section');
    await expect(section.locator('.generated-error')).toContainText('does-not-exist');
    await expect(section.locator('.generated-error')).toContainText('dependency-graph');
  });

  test('generated section goes stale on input change and refreshes on demand', async () => {
    await openDoc('README\\.md', 'Sample Repo');
    const section = page.locator('.generated-section');
    await expect(section.locator('.diagram svg')).toBeVisible({ timeout: 30_000 });

    // New import edge between fresh module buckets → input digest changes.
    const extra = path.join(FIXTURE, 'src', 'feature', 'thing.ts');
    try {
      writeFileSync(path.join(FIXTURE, 'src', 'feature', '.keep'), '', { flag: 'w' });
    } catch {
      // dir may not exist yet
    }
    const { mkdirSync } = await import('node:fs');
    mkdirSync(path.dirname(extra), { recursive: true });
    writeFileSync(extra, "import { util } from '../lib/util';\nexport const feature = util;\n");

    try {
      await expect(section.locator('.stale-badge')).toBeVisible({ timeout: 30_000 });
      await section.locator('button[title="Refresh"]').click();
      await expect(section.locator('.stale-badge')).toHaveCount(0, { timeout: 30_000 });
      await expect(section.locator('.diagram svg')).toBeVisible({ timeout: 30_000 });
    } finally {
      unlinkSync(extra);
      rmSync(path.dirname(extra), { recursive: true, force: true });
    }
  });

  test('draft update shows a reviewable diff and writes only on accept', async () => {
    const guidePath = path.join(FIXTURE, 'docs', 'guide.md');
    const original = readFileSync(guidePath, 'utf8');
    try {
      await openDoc('guide\\.md', 'Guide');
      const heading = page.locator('.doc-article h2', { hasText: 'Details' });
      await heading.hover();
      await heading.locator('.section-action').click();

      const dialog = page.locator('.draft-dialog');
      await expect(dialog).toBeVisible();
      await dialog.locator('textarea').fill('Make it exciting.');
      // File must not change before acceptance.
      await dialog.getByRole('button', { name: 'Draft revision' }).click();
      await expect(dialog.locator('.diff-view')).toBeVisible({ timeout: 20_000 });
      expect(readFileSync(guidePath, 'utf8')).toBe(original);

      await dialog.getByRole('button', { name: 'Accept & apply' }).click();
      await expect(dialog).toHaveCount(0, { timeout: 10_000 });
      await expect.poll(() => readFileSync(guidePath, 'utf8')).toContain('Mock AI response');
    } finally {
      writeFileSync(guidePath, original);
    }
  });

  test('theme switching keeps prose, code, and diagrams legible', async () => {
    await openDoc('README\\.md', 'Sample Repo');
    const initial = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.locator('.titlebar button[title="Toggle light/dark theme"]').click();
    const flipped = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(flipped).not.toBe(initial);
    await expect(page.locator('.doc-article h1')).toBeVisible();
    await expect(page.locator('.doc-article > .diagram svg').first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('.doc-article .code-block').first()).toBeVisible();
    await page.locator('.titlebar button[title="Toggle light/dark theme"]').click();
  });

  test('non-git workspace hides git features gracefully', async () => {
    await expect(page.locator('.doc-actions button', { hasText: 'History' })).toHaveCount(0);
    await page.locator('.sidebar-tabs button', { hasText: 'History' }).click();
    await expect(page.locator('.sidebar-body')).toContainText('not a Git repository');
    await page.locator('.sidebar-tabs button', { hasText: 'Docs' }).click();
  });
});

test.describe.serial('spec scenarios (git repository workspace)', () => {
  let app: ElectronApplication;
  let page: Page;
  let userData: string;
  let repo: string;

  test.beforeAll(async () => {
    const { execSync } = await import('node:child_process');
    const { cpSync } = await import('node:fs');
    repo = mkdtempSync(path.join(tmpdir(), 'livedocs-e2e-git-'));
    cpSync(FIXTURE, repo, { recursive: true });
    const git = (cmd: string) =>
      execSync(`git -c user.email=e2e@test -c user.name=E2E ${cmd}`, { cwd: repo });
    git('init -b main');
    git('add .');
    git('commit -m "feat: initial import"');
    writeFileSync(path.join(repo, 'docs', 'guide.md'), '# Guide\n\nSecond revision.\n');
    git('add .');
    git('commit -m "docs: revise guide"');

    userData = mkdtempSync(path.join(tmpdir(), 'livedocs-e2e-gitud-'));
    app = await _electron.launch({
      args: [MAIN, '--no-sandbox'],
      env: launchEnv({
        LIVEDOCS_WORKSPACE: repo,
        LIVEDOCS_USER_DATA: userData,
        LIVEDOCS_AI_MOCK: '1',
      }),
    });
    page = await app.firstWindow();
    await expect(page.locator('.index-status')).toHaveText(/files indexed/, { timeout: 30_000 });
  });

  test.afterAll(async () => {
    await app?.close();
    rmSync(userData, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  test('history tab shows branch and recent commits with changed files', async () => {
    await page.locator('.sidebar-tabs button', { hasText: 'History' }).click();
    await expect(page.locator('.branch-line')).toContainText('main');
    const commit = page.locator('.commit', { hasText: 'docs: revise guide' });
    await expect(commit).toBeVisible({ timeout: 20_000 });
    await commit.locator('.commit-header').click();
    await expect(commit.locator('.commit-files')).toContainText('docs/guide.md');
  });

  test('per-file history is available from the reading view', async () => {
    await page.locator('.sidebar-tabs button', { hasText: 'Docs' }).click();
    await page
      .locator('.sidebar')
      .getByRole('button', { name: /guide\.md/ })
      .click();
    await page.locator('.doc-actions button', { hasText: 'History' }).click();
    const popover = page.locator('.history-popover');
    await expect(popover).toContainText('docs: revise guide');
    await expect(popover).toContainText('feat: initial import');
  });

  test('summarize recent changes streams with provenance', async () => {
    await page.locator('.doc-actions button', { hasText: 'Recent changes' }).click();
    await expect(page.locator('.ai-panel')).toBeVisible();
    await expect(page.locator('.ai-panel-body')).toContainText('Mock AI response', {
      timeout: 20_000,
    });
    await page.locator('.ai-panel header .icon-button').click();
  });
});

test.describe.serial('spec scenarios (welcome, recents, unconfigured AI)', () => {
  let userData: string;

  test.beforeAll(() => {
    userData = mkdtempSync(path.join(tmpdir(), 'livedocs-e2e-wl-'));
  });
  test.afterAll(() => {
    rmSync(userData, { recursive: true, force: true });
  });

  test('recents persist across launches; reopening restores the workspace db', async () => {
    // First launch records the workspace and builds its index.
    let app = await _electron.launch({
      args: [MAIN, '--no-sandbox'],
      env: launchEnv({ LIVEDOCS_WORKSPACE: FIXTURE, LIVEDOCS_USER_DATA: userData }),
    });
    let page = await app.firstWindow();
    await expect(page.locator('.index-status')).toHaveText(/files indexed/, { timeout: 30_000 });
    await app.close();

    // Second launch with no workspace: welcome screen offers the recent one.
    // Force safeStorage's basic backend so the key-save assertion is
    // deterministic on headless Linux (we no longer persist plaintext when
    // secure storage is unavailable).
    app = await _electron.launch({
      args: [MAIN, '--no-sandbox', '--password-store=basic'],
      env: launchEnv({ LIVEDOCS_USER_DATA: userData }),
    });
    page = await app.firstWindow();
    await expect(page.locator('.welcome')).toBeVisible();
    const recent = page.locator('.recent-item', { hasText: 'sample-repo' });
    await expect(recent).toBeVisible();
    await recent.click();
    await expect(page.locator('.titlebar .workspace-name')).toHaveText('sample-repo', {
      timeout: 20_000,
    });

    // AI is unconfigured in this instance: actions explain setup instead of failing.
    await page
      .locator('.sidebar')
      .getByRole('button', { name: /README\.md/ })
      .click();
    await page.locator('.doc-actions button', { hasText: 'Summarize' }).click();
    await expect(page.locator('.ai-panel')).toContainText('No AI provider is configured');
    await page.locator('.ai-panel').getByRole('button', { name: 'Open Settings' }).click();
    await expect(page.locator('.settings-dialog')).toBeVisible();

    // Cloud API keys require OS secure storage. When it's available the key is
    // stored (encrypted); when it isn't, the app refuses to persist it rather
    // than writing recoverable plaintext, and steers the user to a local
    // provider. Either way the raw key must never hit disk unencrypted.
    await page.locator('.settings-dialog input[type="password"]').fill('sk-e2e-secret-123');
    await page.locator('.settings-dialog').getByRole('button', { name: /Save/ }).click();

    const secureStorageUnavailable = await page
      .locator('.settings-dialog .warning')
      .isVisible()
      .catch(() => false);
    if (secureStorageUnavailable) {
      // No OS secret store: key refused, warning shown, nothing saved.
      await expect(page.locator('.settings-dialog input[type="password"]')).toHaveAttribute(
        'placeholder',
        /paste API key/,
      );
    } else {
      // Secure store present: key saved (encrypted), placeholder reflects it.
      await expect(page.locator('.settings-dialog input[type="password"]')).toHaveAttribute(
        'placeholder',
        /saved/,
      );
    }
    await app.close();

    // The raw key must not appear in the workspace or as raw text in app data.
    const { execSync } = await import('node:child_process');
    const grep = (dir: string) => {
      try {
        execSync(`grep -r "sk-e2e-secret-123" ${JSON.stringify(dir)}`);
        return true;
      } catch {
        return false;
      }
    };
    expect(grep(FIXTURE)).toBe(false);
    expect(grep(userData)).toBe(false);
    expect(existsSync(userData)).toBe(true);
  });
});
