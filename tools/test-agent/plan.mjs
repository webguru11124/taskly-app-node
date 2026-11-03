#!/usr/bin/env node
// Deterministic change analysis: which source files changed, how, what tests
// relate to them and (with --with-coverage) which changed lines are not yet
// covered on the PR head. The agent reads the resulting plan; it never sees
// the raw PR title, body or comments.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  countLines, executableLinesIn, intersectRanges, runTypecheck, runVitest,
} from '../../.claude/skills/run-unit-tests/scripts/lib.mjs';
import { classify, findRelatedTests, riskScore, suggestTestFile } from './lib/classify.mjs';
import { appendOutput, isMain } from './lib/cli.mjs';
import { changedFiles, changedLines, listFiles, readFileAt, resolveRef } from './lib/git.mjs';

export async function buildPlan({
  base, head, mode = 'pr', withCoverage = false, force = false, maxTargets = 12, threshold = 90,
  workspaces: onlyWorkspaces, cwd = process.cwd(), runCoverage = runVitest, typecheck = runTypecheck,
}) {
  const headSha = resolveRef(head, { cwd });
  const baseSha = mode === 'pr' ? resolveRef(base, { cwd }) : null;
  const allFiles = listFiles(headSha, { cwd });
  const testContents = Object.fromEntries(
    allFiles.filter((file) => classify(file).kind === 'test').map((file) => [file, readFileAt(headSha, file, { cwd })]),
  );

  const plan = {
    version: 1, mode, base: baseSha, head: headSha, generatedAt: new Date().toISOString(),
    decision: 'skip', reason: '', workspaces: [], targets: [], skipped: [], covered: [], deleted: [],
    testsChangedInPr: [], baseline: {}, limits: { maxTargets, truncated: false },
  };

  let candidates = [];
  if (mode === 'pr') {
    const changes = changedFiles(baseSha, headSha, { cwd });
    const sourceChanges = [];
    for (const change of changes) {
      const kind = classify(change.file);
      if (change.status === 'deleted') {
        if (kind.kind === 'source') {
          plan.deleted.push({ file: change.file, orphanTests: findRelatedTests(change.file, testContents) });
        }
        continue;
      }
      if (kind.kind === 'test') plan.testsChangedInPr.push(change.file);
      else if (kind.kind === 'source') sourceChanges.push({ ...change, workspace: kind.workspace });
      else plan.skipped.push({ file: change.file, reason: kind.reason });
    }
    const lines = changedLines(baseSha, headSha, sourceChanges.map((change) => change.file), { cwd });
    candidates = sourceChanges.map((change) => ({
      workspace: change.workspace,
      file: change.file,
      status: change.status,
      previous: change.previous,
      changedLines: lines[change.file] ?? [],
    })).filter((candidate) => {
      if (candidate.changedLines.length) return true;
      plan.skipped.push({ file: candidate.file, reason: 'renamed without content changes' });
      return false;
    });
  } else {
    candidates = allFiles
      .map((file) => ({ file, ...classify(file) }))
      .filter((entry) => entry.kind === 'source' && (!onlyWorkspaces || onlyWorkspaces.includes(entry.workspace)))
      .map((entry) => ({ workspace: entry.workspace, file: entry.file, status: 'existing', changedLines: [[1, Number.MAX_SAFE_INTEGER]] }));
  }

  for (const candidate of candidates) {
    candidate.relatedTests = findRelatedTests(candidate.file, testContents);
    candidate.suggestedTestFile = suggestTestFile(candidate.file, candidate.workspace, candidate.relatedTests, allFiles);
    candidate.testsChangedInPr = plan.testsChangedInPr.filter((test) => candidate.relatedTests.includes(test) || test === candidate.suggestedTestFile);
    candidate.coverage = null;
  }

  if (withCoverage) {
    for (const workspace of [...new Set(candidates.map((candidate) => candidate.workspace))].sort()) {
      const run = await runCoverage(workspace, { coverage: true, root: cwd });
      // Vitest does not type-check, so a stale test stub only shows up here.
      const types = await typecheck(workspace, { root: cwd });
      const typeErrors = (types.output ?? '').split('\n').filter((line) => /error TS\d+/.test(line));
      plan.baseline[workspace] = {
        passed: run.testsPassed,
        coverageThresholdsMet: run.thresholdsMet,
        total: run.summary?.total ?? 0,
        failed: run.summary?.failed ?? 0,
        failedTests: (run.summary?.failures ?? []).map((failure) => `${failure.file} › ${failure.name}`).slice(0, 20),
        typecheck: { ok: types.ok, errors: typeErrors.length, sample: typeErrors.slice(0, 5).map((line) => line.trim().slice(0, 300)) },
      };
      const prefix = `${workspace}/`;
      for (const candidate of candidates.filter((entry) => entry.workspace === workspace)) {
        const data = run.coverage?.[candidate.file.slice(prefix.length)];
        if (!data) continue;
        const changedExecutable = executableLinesIn(candidate.changedLines, data.executableLines);
        const uncoveredChanged = intersectRanges(candidate.changedLines, data.uncoveredLines);
        candidate.coverage = {
          lines: data.lines, branches: data.branches, functions: data.functions,
          uncoveredLines: data.uncoveredLines,
          uncoveredChangedLines: uncoveredChanged,
          changedExecutableLineCount: changedExecutable.length,
          uncoveredChangedLineCount: countLines(uncoveredChanged),
        };
      }
    }
  }

  for (const candidate of candidates) {
    const baseline = plan.baseline[candidate.workspace];
    const workspaceFailing = baseline?.passed === false || baseline?.typecheck?.ok === false;
    const coverage = candidate.coverage;
    let needsWork;
    if (force || !withCoverage) needsWork = true;
    else if (!coverage) needsWork = true;
    else if (mode === 'backfill') needsWork = coverage.lines < threshold || coverage.branches < threshold;
    else needsWork = coverage.uncoveredChangedLineCount > 0 || (workspaceFailing && candidate.relatedTests.length > 0);
    if (needsWork) plan.targets.push(candidate);
    else plan.covered.push({ file: candidate.file, reason: mode === 'backfill' ? `coverage at or above ${threshold}%` : 'all changed executable lines are covered by passing tests' });
  }

  plan.targets.sort((a, b) => riskScore(b) - riskScore(a) || a.file.localeCompare(b.file));
  if (plan.targets.length > maxTargets) {
    for (const target of plan.targets.splice(maxTargets)) plan.skipped.push({ file: target.file, reason: 'deferred: target limit reached' });
    plan.limits.truncated = true;
  }
  if (mode === 'backfill') for (const target of plan.targets) target.changedLines = target.coverage?.uncoveredLines ?? [];

  plan.workspaces = [...new Set(plan.targets.map((target) => target.workspace))].sort();
  plan.decision = plan.targets.length ? 'run' : 'skip';
  plan.reason = plan.targets.length
    ? `${plan.targets.length} source file(s) need new or updated tests`
    : mode === 'backfill'
      ? `All ${candidates.length} source file(s) meet the ${threshold}% coverage threshold`
      : candidates.length
        ? `All ${candidates.length} changed source file(s) are already covered by passing tests`
        : 'No unit-testable source files changed';
  return plan;
}

async function main() {
  const { values } = parseArgs({
    options: {
      base: { type: 'string', default: 'origin/main' },
      head: { type: 'string', default: 'HEAD' },
      mode: { type: 'string', default: 'pr' },
      out: { type: 'string', default: '.test-agent/plan.json' },
      'with-coverage': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      'max-targets': { type: 'string', default: process.env.TEST_AGENT_MAX_TARGETS || '12' },
      threshold: { type: 'string', default: '90' },
      workspaces: { type: 'string' },
    },
  });
  if (!['pr', 'backfill'].includes(values.mode)) throw new Error('--mode must be "pr" or "backfill"');
  const plan = await buildPlan({
    base: values.base, head: values.head, mode: values.mode, withCoverage: values['with-coverage'] || values.mode === 'backfill',
    force: values.force, maxTargets: Number(values['max-targets']), threshold: Number(values.threshold),
    workspaces: values.workspaces?.split(','),
  });
  mkdirSync(path.dirname(values.out), { recursive: true });
  writeFileSync(values.out, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(`Plan: ${plan.decision} — ${plan.reason}`);
  for (const target of plan.targets) {
    const uncovered = target.coverage ? `${target.coverage.uncoveredChangedLineCount} uncovered changed line(s)` : 'coverage unknown';
    console.log(`  • ${target.file} (${target.status}; ${uncovered}; tests: ${target.relatedTests.join(', ') || 'none'})`);
  }
  for (const entry of [...plan.covered, ...plan.skipped]) console.log(`  – ${entry.file}: ${entry.reason}`);
  await appendOutput({ decision: plan.decision, workspaces: plan.workspaces.join(','), targets: plan.targets.length });
}

if (isMain(import.meta)) await main();
