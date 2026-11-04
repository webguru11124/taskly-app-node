#!/usr/bin/env node
// Independent verification of the agent's patch. Runs in a job without any
// AI credentials or write token: apply the patch to a clean checkout of the
// PR head, enforce the change policy, then type-check, run the full suites
// with coverage, and rerun the changed test files to catch flakiness. Nothing
// the agent claims is trusted. Every number in the PR comment comes from here.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  WORKSPACES, countLines, executableLinesIn, intersectRanges, runPrettier, runTypecheck, runVitest, truncate,
} from '../../.claude/skills/run-unit-tests/scripts/lib.mjs';
import { appendSummary, isMain, readJsonFile } from './lib/cli.mjs';
import { git } from './lib/git.mjs';
import { checkStagedChanges } from './lib/policy.mjs';

const workspaceOf = (file) => Object.entries(WORKSPACES).find(([, config]) => file.startsWith(`${config.dir}/`))?.[0];

export async function verify({ plan, patchFile, cwd = process.cwd(), reruns = 2, tools = { runTypecheck, runVitest, runPrettier } }) {
  const result = {
    version: 1, status: 'no-changes', passed: false, patchSha256: null, guard: null,
    workspaces: {}, targets: [], testFiles: [], testsAdded: 0,
  };
  const patch = patchFile && existsSync(patchFile) ? readFileSync(patchFile) : Buffer.alloc(0);
  if (!patch.length) return result;
  result.patchSha256 = createHash('sha256').update(patch).digest('hex');

  try {
    git(['apply', '--index', '--whitespace=nowarn', path.resolve(patchFile)], { cwd });
  } catch (error) {
    return { ...result, status: 'apply-failed', error: truncate(String(error.stderr || error.message), 2000) };
  }

  result.guard = checkStagedChanges({ cwd });
  result.testFiles = result.guard.files;
  if (!result.guard.passed) return { ...result, status: 'rejected' };

  const changedByWorkspace = {};
  for (const { path: file } of result.guard.files) {
    const workspace = workspaceOf(file);
    (changedByWorkspace[workspace] ??= []).push(file.slice(WORKSPACES[workspace].dir.length + 1));
  }
  const workspaces = [...new Set([...(plan?.workspaces ?? []), ...Object.keys(changedByWorkspace)])].sort();

  for (const workspace of workspaces) {
    const changedFiles = changedByWorkspace[workspace] ?? [];
    const format = WORKSPACES[workspace].prettier && changedFiles.length ? await tools.runPrettier(workspace, changedFiles, { root: cwd }) : null;
    const typecheck = await tools.runTypecheck(workspace, { root: cwd });
    const suite = await tools.runVitest(workspace, { coverage: true, root: cwd });
    const changedTests = changedFiles.filter((file) => WORKSPACES[workspace].test.test(file));
    const repeatRuns = [];
    for (let run = 0; run < reruns && changedTests.length; run += 1) {
      repeatRuns.push(await tools.runVitest(workspace, { files: changedTests, root: cwd }));
    }
    const summary = suite.summary ?? { total: 0, passed: 0, failed: 0, failures: [], perFile: [] };
    const baselineTotal = plan?.baseline?.[workspace]?.total;
    result.workspaces[workspace] = {
      format: format ? { ok: format.ok, output: format.ok ? '' : truncate(format.output, 1000) } : null,
      typecheck: { ok: typecheck.ok, errors: (typecheck.output.match(/error TS\d+/g) ?? []).length, output: typecheck.ok ? '' : truncate(typecheck.output, 4000) },
      tests: {
        ok: suite.testsPassed,
        total: summary.total, passed: summary.passed, failed: summary.failed,
        failures: summary.failures.slice(0, 10),
        output: suite.testsPassed ? '' : truncate(suite.output, 4000),
      },
      // Reported, not blocking: tests that raise coverage are worth keeping
      // even if the workspace is still below its configured thresholds.
      coverageThresholdsMet: suite.thresholdsMet,
      flaky: {
        ok: repeatRuns.every((run) => run.testsPassed),
        runs: repeatRuns.length,
        files: changedTests,
        failedTests: repeatRuns.flatMap((run) => (run.summary?.failures ?? []).map((failure) => `${failure.file} › ${failure.name}`)).slice(0, 10),
      },
      testsAdded: Number.isInteger(baselineTotal) ? summary.total - baselineTotal : null,
    };
    for (const test of result.testFiles) {
      if (workspaceOf(test.path) !== workspace) continue;
      const relative = test.path.slice(WORKSPACES[workspace].dir.length + 1);
      test.tests = summary.perFile.find((entry) => entry.file === relative)?.total ?? null;
    }
    for (const target of (plan?.targets ?? []).filter((entry) => entry.workspace === workspace)) {
      const after = suite.coverage?.[target.file.slice(WORKSPACES[workspace].dir.length + 1)];
      const changed = after ? executableLinesIn(target.changedLines, after.executableLines).length : null;
      const uncoveredAfter = after ? intersectRanges(target.changedLines, after.uncoveredLines) : null;
      result.targets.push({
        file: target.file,
        changedExecutableLines: changed,
        before: target.coverage ? { lines: target.coverage.lines, branches: target.coverage.branches, uncoveredChangedLines: target.coverage.uncoveredChangedLineCount } : null,
        after: after ? { lines: after.lines, branches: after.branches, uncoveredChangedLines: countLines(uncoveredAfter), uncoveredChangedRanges: uncoveredAfter } : null,
      });
    }
  }

  const checks = Object.values(result.workspaces);
  result.testsAdded = checks.reduce((sum, entry) => sum + (entry.testsAdded ?? 0), 0);
  result.passed = checks.length > 0 && checks.every((entry) => (entry.format?.ok ?? true) && entry.typecheck.ok && entry.tests.ok && entry.flaky.ok);
  result.status = result.passed ? 'passed' : 'failed';
  return result;
}

function summaryMarkdown(result) {
  const lines = [`### Unit Test Agent verification: \`${result.status}\``];
  if (result.guard?.violations.length) lines.push('', '**Policy violations**', ...result.guard.violations.map((v) => `- \`${v.file ?? '*'}${v.line ? `:${v.line}` : ''}\` ${v.rule}: ${v.message}`));
  for (const [workspace, entry] of Object.entries(result.workspaces)) {
    lines.push(`- **${workspace}**: format ${entry.format ? (entry.format.ok ? '✅' : '❌') : '–'} · typecheck ${entry.typecheck.ok ? '✅' : '❌'} · tests ${entry.tests.ok ? '✅' : '❌'} ${entry.tests.passed}/${entry.tests.total} · reruns ${entry.flaky.ok ? '✅' : '❌'} (${entry.flaky.runs})`);
  }
  return lines.join('\n');
}

async function main() {
  const { values } = parseArgs({
    options: {
      plan: { type: 'string', default: '.test-agent/plan.json' },
      patch: { type: 'string', default: '.test-agent/agent.patch' },
      out: { type: 'string', default: '.test-agent/verification.json' },
      reruns: { type: 'string', default: '2' },
    },
  });
  const result = await verify({ plan: readJsonFile(values.plan), patchFile: values.patch, reruns: Number(values.reruns) });
  mkdirSync(path.dirname(values.out), { recursive: true });
  writeFileSync(values.out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(summaryMarkdown(result));
  appendSummary(summaryMarkdown(result));
  if (result.status === 'failed' || result.status === 'rejected' || result.status === 'apply-failed') {
    console.log(`::warning title=Unit Test Agent::Generated tests ${result.status}; nothing will be committed.`);
  }
}

if (isMain(import.meta)) await main();
