import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';

const E2E_DIR = import.meta.dirname;
const FIXTURE = path.join(E2E_DIR, 'fixtures', 'sample-repo');

let app: ElectronApplication;
let page: Page;
let userData: string;

test.beforeAll(async () => {
  userData = mkdtempSync(path.join(tmpdir(), 'livedocs-e2e-'));
  const env = { ...process.env } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({
    args: [path.join(E2E_DIR, '..', 'out', 'main', 'index.js'), '--no-sandbox'],
    env: {
      ...env,
      LIVEDOCS_WORKSPACE: FIXTURE,
      LIVEDOCS_USER_DATA: userData,
      LIVEDOCS_AI_MOCK: '1',
      LIVEDOCS_NO_SANDBOX: '1',
    },
  });
  page = await app.firstWindow();
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`[renderer:${msg.type()}]`, msg.text());
    }
  });
});

/** Open a document from the Docs tree, from any prior UI state. */
async function openDoc(name: string, expectedH1: string): Promise<void> {
  await page.locator('.sidebar-tabs button', { hasText: 'Docs' }).click();
  await page
    .locator('.sidebar')
    .getByRole('button', { name: new RegExp(name) })
    .click();
  await expect(page.locator('.doc-article h1')).toHaveText(expectedH1);
}

test.afterAll(async () => {
  await app?.close();
  rmSync(userData, { recursive: true, force: true });
  // The smoke test appends to the fixture README (watcher check); restore it.
  const readme = path.join(FIXTURE, 'README.md');
  const content = readFileSync(readme, 'utf8');
  const marker = content.indexOf('<!-- e2e-live-update -->');
  if (marker !== -1) writeFileSync(readme, content.slice(0, marker).trimEnd() + '\n');
});

test('workspace opens and the index builds', async () => {
  await expect(page.locator('.titlebar .workspace-name')).toHaveText('sample-repo');
  await expect(page.locator('.index-status')).toHaveText(/files indexed/, { timeout: 30_000 });
});

test('docs tree shows markdown prominently and opens the README', async () => {
  const sidebar = page.locator('.sidebar');
  await expect(sidebar.getByRole('button', { name: /README\.md/ })).toBeVisible();
  await sidebar.getByRole('button', { name: /README\.md/ }).click();
  await expect(page.locator('.doc-article h1')).toHaveText('Sample Repo');
});

test('mermaid diagram renders as SVG and enlarges on click', async () => {
  await openDoc('README.md', 'Sample Repo');
  const diagram = page.locator('.doc-article > .diagram svg').first();
  await expect(diagram).toBeVisible({ timeout: 30_000 });
  await page.locator('.doc-article > .diagram').first().click();
  await expect(page.locator('.lightbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.lightbox')).toHaveCount(0);
});

test('generated dependency-graph section renders with provenance', async () => {
  await openDoc('README.md', 'Sample Repo');
  const section = page.locator('.generated-section');
  await expect(section).toBeVisible();
  await expect(section.locator('.generated-badge')).toContainText('dependency-graph');
  // Deterministic generator emits a Mermaid diagram from the indexed imports.
  await expect(section.locator('.diagram svg')).toBeVisible({ timeout: 30_000 });
  await section.locator('button[title="Provenance"]').click();
  await expect(page.locator('.provenance-popover')).toContainText('deterministic');
  await section.locator('button[title="Provenance"]').click();
});

test('table of contents navigates the document', async () => {
  await openDoc('README.md', 'Sample Repo');
  await expect(page.locator('.toc')).toContainText('Architecture');
});

test('code blocks are syntax highlighted with a plain fallback', async () => {
  await openDoc('README.md', 'Sample Repo');
  await expect(page.locator('.doc-article .code-block .shiki').first()).toBeVisible({
    timeout: 30_000,
  });
});

test('relative links open in-app', async () => {
  await openDoc('README.md', 'Sample Repo');
  await page.locator('.doc-article a', { hasText: 'guide' }).click();
  await expect(page.locator('.doc-article h1')).toHaveText('Guide');
});

test('search finds content and opens the file', async () => {
  await page.locator('.sidebar-tabs button', { hasText: 'Search' }).click();
  await page.locator('.search-panel input').fill('capacitor');
  const result = page.locator('.search-result', { hasText: 'guide.md' });
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.locator('.doc-article h1')).toHaveText('Guide');
});

test('explain selection streams a mock AI answer with provenance', async () => {
  await openDoc('guide\\.md', 'Guide');
  // Select the first paragraph, then release the mouse over the article.
  const paragraph = page.locator('.doc-article p').first();
  await paragraph.selectText();
  await paragraph.dispatchEvent('mouseup', { bubbles: true });
  await page.locator('.explain-fab').click();
  await expect(page.locator('.ai-panel')).toBeVisible();
  await expect(page.locator('.ai-panel-body')).toContainText('Mock AI response', {
    timeout: 20_000,
  });
  await expect(page.locator('.ai-panel .provenance-line')).toContainText('mock-model');
  await page.locator('.ai-panel header .icon-button').click();
});

test('editing a file on disk live-refreshes the open document', async () => {
  await openDoc('README.md', 'Sample Repo');
  const readme = path.join(FIXTURE, 'README.md');
  const original = readFileSync(readme, 'utf8');
  writeFileSync(
    readme,
    original.trimEnd() + '\n\n<!-- e2e-live-update -->\n\n## Live Update Heading\n',
  );
  await expect(page.locator('.doc-article')).toContainText('Live Update Heading', {
    timeout: 20_000,
  });
});
