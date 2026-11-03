// Shared, dependency-free helpers for running Vitest/tsc in a workspace and
// reading Istanbul coverage. Used by run-tests.mjs (the agent's only shell
// entry point) and by tools/test-agent (plan + independent verification).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

export const WORKSPACES = {
  backend: {
    dir: 'backend',
    test: /^tests\/(?:[\w.-]+\/)*[\w.-]+\.test\.ts$/,
    source: /^src\/(?:[\w.-]+\/)*[\w.-]+\.ts$/,
  },
  frontend: {
    dir: 'frontend',
    test: /^src\/(?:[\w.-]+\/)*[\w.-]+\.test\.tsx?$/,
    source: /^src\/(?:[\w.-]+\/)*[\w.-]+\.tsx?$/,
  },
};

// Only these variables reach test processes. Everything else (tokens, API
// keys, GITHUB_*, NODE_OPTIONS, npm_config_*) is dropped on purpose.
const ENV_ALLOWLIST = new Set([
  'PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'WINDIR', 'COMSPEC',
  'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ',
]);

export function sanitizedEnv(source = process.env) {
  const env = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && ENV_ALLOWLIST.has(name.toUpperCase())) env[name] = value;
  }
  return { ...env, CI: 'true', NODE_ENV: 'test', NO_COLOR: '1', FORCE_COLOR: '0' };
}

export function workspaceDir(workspace, root = REPO_ROOT) {
  const config = WORKSPACES[workspace];
  if (!config) throw new UsageError(`Unknown workspace "${workspace}". Use one of: ${Object.keys(WORKSPACES).join(', ')}.`);
  return path.join(root, config.dir);
}

export class UsageError extends Error {}

/**
 * Normalises a test or source path to be workspace-relative and validates it
 * against the workspace's allowlist pattern. Accepts repo-relative paths too.
 */
export function normalizeWorkspacePath(workspace, file, kind, root = REPO_ROOT) {
  const config = WORKSPACES[workspace];
  let relative = String(file).replaceAll('\\', '/').replace(/^\.\//, '');
  if (relative.startsWith(`${config.dir}/`)) relative = relative.slice(config.dir.length + 1);
  if (relative.split('/').includes('..') || !config[kind].test(relative)) {
    throw new UsageError(`Refusing ${kind} path "${file}" for ${workspace}: it must match ${config[kind]}.`);
  }
  if (!existsSync(path.join(workspaceDir(workspace, root), relative))) {
    throw new UsageError(`File not found in ${workspace}: ${relative}`);
  }
  return relative;
}

function binary(workspace, relative, root) {
  const file = path.join(workspaceDir(workspace, root), 'node_modules', relative);
  if (!existsSync(file)) throw new UsageError(`Missing ${relative} in ${workspace}. Run "npm ci" in ${workspace}/ first.`);
  return file;
}

export function runProcess(args, { cwd, timeoutMs = 10 * 60_000, env = sanitizedEnv() } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    const append = (chunk) => { output += chunk; };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: timedOut ? 124 : code ?? 1, timedOut, output: stripAnsi(output) });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, timedOut: false, output: String(error) });
    });
  });
}

export function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

export function truncate(text, limit = 12_000) {
  if (text.length <= limit) return text;
  const head = Math.floor(limit * 0.2);
  const tail = limit - head;
  return `${text.slice(0, head)}\n… [${text.length - limit} characters truncated] …\n${text.slice(-tail)}`;
}

/** Runs `tsc --noEmit` with the workspace tsconfig (which includes tests). */
export async function runTypecheck(workspace, { root = REPO_ROOT } = {}) {
  const tsc = binary(workspace, 'typescript/bin/tsc', root);
  const result = await runProcess([tsc, '--noEmit', '--pretty', 'false'], { cwd: workspaceDir(workspace, root) });
  return { ...result, ok: result.exitCode === 0 };
}

/**
 * Runs Vitest once. Returns the process result plus the parsed JSON report
 * (test counts and failures) and, with coverage, the Istanbul file map.
 */
export async function runVitest(workspace, { files = [], coverage = false, root = REPO_ROOT, timeoutMs } = {}) {
  const cwd = workspaceDir(workspace, root);
  const vitest = binary(workspace, 'vitest/vitest.mjs', root);
  const scratch = mkdtempSync(path.join(tmpdir(), 'run-tests-'));
  const reportFile = path.join(scratch, 'report.json');
  const args = [vitest, 'run', ...files, '--reporter=default', '--reporter=json', `--outputFile.json=${reportFile}`];
  if (coverage) {
    // reportOnFailure: a PR that breaks one test must still get line data for
    // every changed file, otherwise the plan can't say what is uncovered.
    args.push('--coverage.enabled=true', '--coverage.reportOnFailure=true', '--coverage.reporter=json',
      '--coverage.reporter=json-summary', `--coverage.reportsDirectory=${path.join(scratch, 'coverage')}`);
  }
  try {
    const result = await runProcess(args, { cwd, timeoutMs });
    const report = readJson(reportFile);
    const coverageMap = coverage ? readJson(path.join(scratch, 'coverage', 'coverage-final.json')) : null;
    const summary = summarizeReport(report, cwd);
    // Vitest also exits non-zero when coverage thresholds are missed; keep
    // that apart from failing tests so callers can tell the two cases apart.
    const testsPassed = Boolean(summary && summary.total > 0 && summary.failed === 0 && !summary.failures.length && !result.timedOut);
    return {
      ...result,
      ok: result.exitCode === 0,
      testsPassed,
      thresholdsMet: !coverage ? null : result.exitCode === 0 ? true : testsPassed ? false : null,
      summary,
      coverage: coverageMap ? summarizeCoverage(coverageMap, cwd) : null,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

export function summarizeReport(report, workspaceRoot = '') {
  if (!report) return null;
  const failures = [];
  const perFile = [];
  for (const file of report.testResults ?? []) {
    const tests = file.assertionResults ?? [];
    perFile.push({
      file: (workspaceRoot ? path.relative(workspaceRoot, file.name ?? '') : path.basename(file.name ?? '')).replaceAll('\\', '/'),
      total: tests.length,
      failed: tests.filter((test) => test.status === 'failed').length,
    });
    for (const test of file.assertionResults ?? []) {
      if (test.status === 'failed') {
        failures.push({
          file: path.basename(file.name ?? ''),
          name: test.fullName ?? test.title,
          message: truncate(stripAnsi((test.failureMessages ?? []).join('\n')), 1500),
        });
      }
    }
    if (file.status === 'failed' && !(file.assertionResults ?? []).some((test) => test.status === 'failed')) {
      failures.push({ file: path.basename(file.name ?? ''), name: '(file failed to load)', message: truncate(stripAnsi(file.message ?? ''), 1500) });
    }
  }
  return {
    files: (report.testResults ?? []).length,
    total: report.numTotalTests ?? 0,
    passed: report.numPassedTests ?? 0,
    failed: report.numFailedTests ?? 0,
    skipped: (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0),
    failures,
    perFile,
  };
}

/** Collapses sorted line numbers into inclusive [start, end] ranges. */
export function toRanges(lines) {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const ranges = [];
  for (const line of sorted) {
    const last = ranges.at(-1);
    if (last && line === last[1] + 1) last[1] = line;
    else ranges.push([line, line]);
  }
  return ranges;
}

export function formatRanges(ranges) {
  return ranges.map(([start, end]) => (start === end ? `${start}` : `${start}-${end}`)).join(', ');
}

const percent = (covered, total) => (total === 0 ? 100 : Math.round((covered / total) * 1000) / 10);

/**
 * Converts an Istanbul coverage map into per-file metrics keyed by the
 * workspace-relative POSIX path. Line coverage follows Istanbul: a line's hit
 * count is the highest count of the statements that start on it.
 */
export function summarizeCoverage(coverageMap, workspaceRoot) {
  const files = {};
  for (const data of Object.values(coverageMap)) {
    const relative = path.relative(workspaceRoot, data.path).replaceAll('\\', '/');
    const lineHits = new Map();
    for (const [id, location] of Object.entries(data.statementMap ?? {})) {
      const line = location.start.line;
      lineHits.set(line, Math.max(lineHits.get(line) ?? 0, data.s?.[id] ?? 0));
    }
    const uncovered = [...lineHits].filter(([, hits]) => hits === 0).map(([line]) => line);
    const statements = Object.values(data.s ?? {});
    const functions = Object.values(data.f ?? {});
    const branchCounts = Object.values(data.b ?? {}).flat();
    const uncoveredBranchLines = [];
    for (const [id, branch] of Object.entries(data.branchMap ?? {})) {
      (data.b?.[id] ?? []).forEach((hits, index) => {
        if (hits === 0) uncoveredBranchLines.push(branch.locations?.[index]?.start?.line ?? branch.loc?.start?.line ?? branch.line);
      });
    }
    files[relative] = {
      lines: percent(lineHits.size - uncovered.length, lineHits.size),
      statements: percent(statements.filter((hits) => hits > 0).length, statements.length),
      branches: percent(branchCounts.filter((hits) => hits > 0).length, branchCounts.length),
      functions: percent(functions.filter((hits) => hits > 0).length, functions.length),
      uncoveredLines: toRanges(uncovered),
      uncoveredBranchLines: [...new Set(uncoveredBranchLines.filter(Number.isInteger))].sort((a, b) => a - b),
      executableLines: [...lineHits.keys()].sort((a, b) => a - b),
    };
  }
  return files;
}

/** Intersects inclusive line ranges with a set of uncovered ranges. */
export function intersectRanges(ranges, uncovered) {
  const hits = [];
  for (const [start, end] of ranges) {
    for (const [uStart, uEnd] of uncovered) {
      const from = Math.max(start, uStart);
      const to = Math.min(end, uEnd);
      if (from <= to) for (let line = from; line <= to; line += 1) hits.push(line);
    }
  }
  return toRanges(hits);
}

export function countLines(ranges) {
  return ranges.reduce((total, [start, end]) => total + end - start + 1, 0);
}

/** Executable lines (statement starts) that fall inside the given ranges. */
export function executableLinesIn(ranges, executableLines) {
  return executableLines.filter((line) => ranges.some(([start, end]) => line >= start && line <= end));
}
