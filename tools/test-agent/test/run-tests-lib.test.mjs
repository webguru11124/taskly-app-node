import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  REPO_ROOT, UsageError, countLines, executableLinesIn, formatRanges, intersectRanges, normalizeWorkspacePath,
  sanitizedEnv, summarizeCoverage, summarizeReport, toRanges, truncate,
} from '../../../.claude/skills/run-unit-tests/scripts/lib.mjs';

describe('run-unit-tests helpers', () => {
  it('keeps only allow-listed variables in the test environment', () => {
    const env = sanitizedEnv({ PATH: '/bin', Path: 'C:\\bin', HOME: '/h', GITHUB_TOKEN: 'x', CLAUDE_CODE_OAUTH_TOKEN: 'y', ANTHROPIC_API_KEY: 'z', NODE_OPTIONS: '--inspect', npm_config_registry: 'r' });
    assert.deepEqual(env, { PATH: '/bin', Path: 'C:\\bin', HOME: '/h', CI: 'true', NODE_ENV: 'test', NO_COLOR: '1', FORCE_COLOR: '0' });
  });

  it('accepts workspace and repo relative test paths that exist', () => {
    assert.equal(normalizeWorkspacePath('backend', 'backend/tests/router.test.ts', 'test'), 'tests/router.test.ts');
    assert.equal(normalizeWorkspacePath('backend', './tests/router.test.ts', 'test'), 'tests/router.test.ts');
    assert.equal(normalizeWorkspacePath('frontend', 'frontend\\src\\App.test.tsx', 'test'), 'src/App.test.tsx');
  });

  it('refuses traversal, non-test files, options and missing files', () => {
    for (const [workspace, file] of [['backend', 'tests/../../.github/x.test.ts'], ['backend', 'src/factory.ts'], ['frontend', '--config=evil.ts'], ['backend', 'tests/missing.test.ts'], ['frontend', 'src/App.tsx']]) {
      assert.throws(() => normalizeWorkspacePath(workspace, file, 'test'), UsageError, `${workspace}:${file}`);
    }
  });

  it('works with line ranges', () => {
    assert.deepEqual(toRanges([5, 3, 4, 9, 9, 10, 1]), [[1, 1], [3, 5], [9, 10]]);
    assert.equal(formatRanges([[1, 1], [3, 5]]), '1, 3-5');
    assert.deepEqual(intersectRanges([[1, 10], [20, 22]], [[5, 21]]), [[5, 10], [20, 21]]);
    assert.equal(countLines([[1, 1], [3, 5]]), 4);
    assert.deepEqual(executableLinesIn([[2, 4]], [1, 2, 4, 8]), [2, 4]);
  });

  it('truncates long output from the middle', () => {
    const text = truncate('a'.repeat(50) + 'b'.repeat(50), 20);
    assert.ok(text.startsWith('aaaa') && text.endsWith('bbbb') && text.includes('80 characters truncated'));
  });

  it('summarises Istanbul coverage per workspace-relative file', () => {
    const root = path.join(REPO_ROOT, 'backend');
    const map = {
      x: {
        path: path.join(root, 'src', 'a.ts'),
        statementMap: { 0: { start: { line: 1 } }, 1: { start: { line: 2 } }, 2: { start: { line: 2 } }, 3: { start: { line: 5 } } },
        s: { 0: 1, 1: 0, 2: 3, 3: 0 },
        fnMap: { 0: {} }, f: { 0: 1 },
        branchMap: { 0: { locations: [{ start: { line: 5 } }, { start: { line: 6 } }] } }, b: { 0: [0, 2] },
      },
    };
    assert.deepEqual(summarizeCoverage(map, root)['src/a.ts'], {
      lines: 66.7, statements: 50, branches: 50, functions: 100,
      uncoveredLines: [[5, 5]], uncoveredBranchLines: [5], executableLines: [1, 2, 5],
    });
  });

  it('summarises a Vitest JSON report with failures', () => {
    const summary = summarizeReport({
      numTotalTests: 2, numPassedTests: 1, numFailedTests: 1,
      testResults: [{ name: '/w/tests/a.test.ts', status: 'failed', assertionResults: [{ status: 'passed' }, { status: 'failed', fullName: 'a fails', failureMessages: ['\u001b[31mexpected 1\u001b[39m'] }] }],
    }, '/w');
    assert.equal(summary.failed, 1);
    assert.deepEqual(summary.failures, [{ file: 'a.test.ts', name: 'a fails', message: 'expected 1' }]);
    assert.deepEqual(summary.perFile, [{ file: 'tests/a.test.ts', total: 2, failed: 1 }]);
  });
});
