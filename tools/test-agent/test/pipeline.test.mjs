// Integration tests for plan.mjs and verify.mjs against throwaway git repos.
// Test execution is stubbed, so these run without node_modules.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { git } from '../lib/git.mjs';
import { buildPlan } from '../plan.mjs';
import { verify } from '../verify.mjs';

const repos = [];
after(() => { for (const repo of repos) rmSync(repo, { recursive: true, force: true }); });

function repo(files) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'test-agent-'));
  repos.push(cwd);
  git(['init', '-q', '-b', 'main'], { cwd });
  git(['config', 'user.email', 'test@example.com'], { cwd });
  git(['config', 'user.name', 'Test'], { cwd });
  git(['config', 'core.autocrlf', 'false'], { cwd });
  write(cwd, files);
  commit(cwd, 'base');
  return cwd;
}

function write(cwd, files) {
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    writeFileSync(path.join(cwd, file), contents);
  }
}

function commit(cwd, message) {
  git(['add', '-A'], { cwd });
  git(['commit', '-q', '-m', message], { cwd });
  return git(['rev-parse', 'HEAD'], { cwd }).trim();
}

const base = {
  'backend/src/features/todos/router.ts': 'export function a() {\n  return 1;\n}\n',
  'backend/tests/router.test.ts': "import { a } from '../src/features/todos/router.ts';\n",
  'frontend/src/lib/http.ts': 'export const x = 1\n',
  'README.md': '# readme\n',
};

describe('plan', () => {
  it('classifies a PR diff into targets, skipped files and deletions', async () => {
    const cwd = repo(base);
    const baseSha = git(['rev-parse', 'HEAD'], { cwd }).trim();
    write(cwd, {
      'backend/src/features/todos/router.ts': 'export function a() {\n  return 2;\n}\nexport const b = 3;\n',
      'frontend/src/features/todos/utils/new.ts': 'export const y = 2\n',
      'frontend/src/features/todos/types.ts': 'export type T = 1\n',
      'README.md': '# changed\n',
    });
    git(['rm', '-q', 'frontend/src/lib/http.ts'], { cwd });
    const headSha = commit(cwd, 'head');

    const plan = await buildPlan({ base: baseSha, head: headSha, cwd });
    assert.equal(plan.decision, 'run');
    // A new, untested utility outranks a modified router that already has tests.
    assert.deepEqual(plan.targets.map((t) => [t.file, t.status, t.changedLines, t.relatedTests, t.suggestedTestFile]), [
      ['frontend/src/features/todos/utils/new.ts', 'added', [[1, 1]], [], 'frontend/src/features/todos/utils/new.test.ts'],
      ['backend/src/features/todos/router.ts', 'modified', [[2, 2], [4, 4]], ['backend/tests/router.test.ts'], 'backend/tests/router.test.ts'],
    ]);
    assert.deepEqual(plan.skipped.map((s) => s.file).sort(), ['README.md', 'frontend/src/features/todos/types.ts']);
    assert.deepEqual(plan.deleted, [{ file: 'frontend/src/lib/http.ts', orphanTests: [] }]);
    assert.deepEqual(plan.workspaces, ['backend', 'frontend']);
  });

  it('drops targets whose changed lines are already covered by passing tests', async () => {
    const cwd = repo(base);
    const baseSha = git(['rev-parse', 'HEAD'], { cwd }).trim();
    write(cwd, { 'backend/src/features/todos/router.ts': 'export function a() {\n  return 5;\n}\n' });
    const headSha = commit(cwd, 'head');
    const runCoverage = async () => ({
      ok: true, testsPassed: true, thresholdsMet: true,
      summary: { total: 4, failed: 0, failures: [] },
      coverage: { 'src/features/todos/router.ts': { lines: 100, branches: 100, functions: 100, uncoveredLines: [], executableLines: [2] } },
    });
    const typecheck = async () => ({ ok: true, output: '' });
    const plan = await buildPlan({ base: baseSha, head: headSha, cwd, withCoverage: true, runCoverage, typecheck });
    assert.equal(plan.decision, 'skip');
    assert.equal(plan.reason, 'All 1 changed source file(s) are already covered by passing tests');
    assert.deepEqual(plan.covered.map((c) => c.file), ['backend/src/features/todos/router.ts']);
    assert.deepEqual(plan.baseline.backend, { passed: true, coverageThresholdsMet: true, total: 4, failed: 0, failedTests: [], typecheck: { ok: true, errors: 0, sample: [] } });

    const forced = await buildPlan({ base: baseSha, head: headSha, cwd, withCoverage: true, runCoverage, typecheck, force: true });
    assert.equal(forced.decision, 'run');
  });

  it('keeps covered targets with tests when the baseline has type errors', async () => {
    const cwd = repo(base);
    const baseSha = git(['rev-parse', 'HEAD'], { cwd }).trim();
    write(cwd, { 'backend/src/features/todos/router.ts': 'export function a() {\n  return 6;\n}\n' });
    const headSha = commit(cwd, 'head');
    const runCoverage = async () => ({
      ok: true, testsPassed: true, thresholdsMet: true,
      summary: { total: 4, failed: 0, failures: [] },
      coverage: { 'src/features/todos/router.ts': { lines: 100, branches: 100, functions: 100, uncoveredLines: [], executableLines: [2] } },
    });
    const typecheck = async () => ({ ok: false, output: "tests/router.test.ts(3,1): error TS2741: Property 'b' is missing.\n" });
    const plan = await buildPlan({ base: baseSha, head: headSha, cwd, withCoverage: true, runCoverage, typecheck });
    assert.equal(plan.decision, 'run');
    assert.deepEqual(plan.baseline.backend.typecheck, { ok: false, errors: 1, sample: ["tests/router.test.ts(3,1): error TS2741: Property 'b' is missing."] });
  });

  it('skips PRs without unit-testable sources', async () => {
    const cwd = repo(base);
    const baseSha = git(['rev-parse', 'HEAD'], { cwd }).trim();
    write(cwd, { 'README.md': 'docs only\n', 'backend/tests/router.test.ts': '// author added tests\n' });
    const plan = await buildPlan({ base: baseSha, head: commit(cwd, 'docs'), cwd });
    assert.equal(plan.decision, 'skip');
    assert.equal(plan.reason, 'No unit-testable source files changed');
    assert.deepEqual(plan.testsChangedInPr, ['backend/tests/router.test.ts']);
  });
});

describe('verify', () => {
  const passing = {
    runTypecheck: async () => ({ ok: true, output: '' }),
    runVitest: async (workspace, { files = [] } = {}) => ({
      ok: true, testsPassed: true, thresholdsMet: true, output: '',
      summary: { total: files.length ? 2 : 50, passed: files.length ? 2 : 50, failed: 0, failures: [], perFile: [{ file: 'tests/router.test.ts', total: 7, failed: 0 }] },
      coverage: { 'src/features/todos/router.ts': { lines: 100, branches: 100, uncoveredLines: [], executableLines: [2] } },
    }),
  };
  const plan = {
    workspaces: ['backend'], baseline: { backend: { total: 48 } },
    targets: [{ workspace: 'backend', file: 'backend/src/features/todos/router.ts', changedLines: [[2, 2]], coverage: { lines: 50, branches: 0, uncoveredChangedLineCount: 1 } }],
  };

  function patchFor(cwd, files) {
    write(cwd, files);
    git(['add', '-A'], { cwd });
    const patch = git(['diff', '--cached', '--binary', 'HEAD'], { cwd });
    git(['reset', '-q', '--hard', 'HEAD'], { cwd });
    const file = path.join(cwd, '..', `${path.basename(cwd)}.patch`);
    writeFileSync(file, patch);
    repos.push(file);
    return file;
  }

  it('passes a test-only patch and reports coverage before and after', async () => {
    const cwd = repo(base);
    const patchFile = patchFor(cwd, { 'backend/tests/router.test.ts': "import { a } from '../src/features/todos/router.ts';\nit('a', () => expect(a()).toBe(1));\n" });
    const result = await verify({ plan, patchFile, cwd, tools: passing });
    assert.equal(result.status, 'passed', JSON.stringify(result.guard?.violations));
    assert.match(result.patchSha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(result.testFiles, [{ path: 'backend/tests/router.test.ts', status: 'M', tests: 7 }]);
    assert.equal(result.workspaces.backend.testsAdded, 2);
    assert.equal(result.workspaces.backend.flaky.runs, 2);
    assert.deepEqual(result.targets[0].after, { lines: 100, branches: 100, uncoveredChangedLines: 0, uncoveredChangedRanges: [] });
  });

  it('rejects a patch that touches production code without running anything', async () => {
    const cwd = repo(base);
    const patchFile = patchFor(cwd, { 'backend/src/features/todos/router.ts': 'export const hacked = true;\n' });
    let ran = false;
    const result = await verify({ plan, patchFile, cwd, tools: { runTypecheck: async () => { ran = true; }, runVitest: async () => { ran = true; } } });
    assert.equal(result.status, 'rejected');
    assert.equal(ran, false);
    assert.deepEqual(result.guard.violations.map((v) => v.rule), ['path-not-allowed']);
  });

  it('fails when the generated tests fail', async () => {
    const cwd = repo(base);
    const patchFile = patchFor(cwd, { 'backend/tests/new.test.ts': "it('x', () => expect(1).toBe(2));\n" });
    const failing = { ...passing, runVitest: async () => ({ ok: false, testsPassed: false, thresholdsMet: null, output: 'boom', summary: { total: 1, passed: 0, failed: 1, failures: [{ file: 'new.test.ts', name: 'x', message: 'expected 2' }], perFile: [] } }) };
    const result = await verify({ plan, patchFile, cwd, tools: failing });
    assert.equal(result.status, 'failed');
    assert.equal(result.workspaces.backend.tests.failures[0].message, 'expected 2');
  });

  it('passes passing tests even when coverage thresholds are still missed', async () => {
    const cwd = repo(base);
    const patchFile = patchFor(cwd, { 'backend/tests/new.test.ts': "it('x', () => expect(1).toBe(1));\n" });
    const belowThreshold = {
      ...passing,
      runVitest: async (...args) => ({ ...(await passing.runVitest(...args)), ok: false, thresholdsMet: false }),
    };
    const result = await verify({ plan, patchFile, cwd, tools: belowThreshold });
    assert.equal(result.status, 'passed');
    assert.equal(result.workspaces.backend.coverageThresholdsMet, false);
  });

  it('reports an empty patch as no changes', async () => {
    const cwd = repo(base);
    const empty = path.join(cwd, 'empty.patch');
    writeFileSync(empty, '');
    assert.equal((await verify({ plan, patchFile: empty, cwd, tools: passing })).status, 'no-changes');
  });
});
