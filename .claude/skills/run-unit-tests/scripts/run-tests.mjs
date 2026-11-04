#!/usr/bin/env node
// The only command the unit-test agent may run. It validates every argument,
// runs Vitest or tsc with a scrubbed environment and a timeout, prints compact
// output, and ends with one machine-readable RESULT line.
import {
  UsageError, WORKSPACES, formatRanges, normalizeWorkspacePath, runTypecheck, runVitest, truncate,
} from './lib.mjs';

const USAGE = `Usage: node .claude/skills/run-unit-tests/scripts/run-tests.mjs <workspace> <command> [options]

  workspace   ${Object.keys(WORKSPACES).join(' | ')}
  command
    test [files...] [--runs N]   Run all tests, or only the given test files. --runs (1-5)
                                 repeats the run to detect flaky tests.
    typecheck                    Type-check the workspace (sources and tests).
    coverage [--source file...]  Run the whole suite with coverage and report the given
                                 source files (default: every file below 100 %).`;

function parse(argv) {
  const [workspace, command, ...rest] = argv;
  if (!workspace || workspace === '--help' || !command) throw new UsageError(USAGE);
  if (!WORKSPACES[workspace]) throw new UsageError(`Unknown workspace "${workspace}".\n\n${USAGE}`);
  const options = { workspace, command, files: [], sources: [], runs: 1 };
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === '--runs') {
      options.runs = Number(rest[++index]);
      if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 5) throw new UsageError('--runs must be an integer from 1 to 5.');
    } else if (value === '--source') {
      options.sources.push(normalizeWorkspacePath(workspace, rest[++index] ?? '', 'source'));
    } else if (value.startsWith('-')) {
      throw new UsageError(`Unknown option "${value}".\n\n${USAGE}`);
    } else if (command === 'test') {
      options.files.push(normalizeWorkspacePath(workspace, value, 'test'));
    } else {
      throw new UsageError(`Unexpected argument "${value}".\n\n${USAGE}`);
    }
  }
  if (!['test', 'typecheck', 'coverage'].includes(command)) throw new UsageError(`Unknown command "${command}".\n\n${USAGE}`);
  if (options.files.length > 20) throw new UsageError('Pass at most 20 test files per run.');
  return options;
}

function printFailures(summary) {
  if (!summary?.failures.length) return;
  console.log(`\nFailures (${summary.failures.length}):`);
  for (const failure of summary.failures.slice(0, 15)) {
    console.log(`\n✗ ${failure.file} › ${failure.name}\n${failure.message}`);
  }
}

async function test({ workspace, files, runs }) {
  const results = [];
  for (let run = 1; run <= runs; run += 1) {
    const result = await runVitest(workspace, { files });
    results.push(result);
    const label = runs > 1 ? ` (run ${run}/${runs})` : '';
    console.log(`## vitest ${workspace}${label}: exit ${result.exitCode}${result.timedOut ? ' (timed out)' : ''}`);
    console.log(truncate(result.output, runs > 1 ? 4000 : 12_000));
    printFailures(result.summary);
  }
  const outcomes = new Set(results.map((result) => result.ok));
  const last = results.at(-1);
  return {
    ok: results.every((result) => result.ok),
    flaky: outcomes.size > 1,
    runs,
    ...(last.summary ?? {}),
    failures: undefined,
    perFile: undefined,
    failedTests: (last.summary?.failures ?? []).map((failure) => `${failure.file} › ${failure.name}`).slice(0, 20),
  };
}

async function typecheck({ workspace }) {
  const result = await runTypecheck(workspace);
  console.log(`## tsc --noEmit ${workspace}: exit ${result.exitCode}`);
  console.log(truncate(result.output || '(no type errors)', 12_000));
  return { ok: result.ok, errors: (result.output.match(/error TS\d+/g) ?? []).length };
}

async function coverage({ workspace, sources }) {
  const result = await runVitest(workspace, { coverage: true });
  console.log(`## vitest --coverage ${workspace}: exit ${result.exitCode}`);
  if (result.thresholdsMet === false) console.log('All tests passed, but the workspace coverage thresholds (vitest config) are not met.');
  else if (!result.ok) console.log(truncate(result.output, 6000));
  printFailures(result.summary);
  const files = result.coverage ?? {};
  const selected = sources.length ? sources : Object.keys(files).filter((file) => files[file].lines < 100 || files[file].branches < 100);
  console.log('\nfile | lines % | branches % | functions % | uncovered lines | uncovered branches at lines');
  for (const file of selected) {
    const data = files[file];
    if (!data) { console.log(`${file} | not instrumented (excluded from coverage or never imported)`); continue; }
    console.log(`${file} | ${data.lines} | ${data.branches} | ${data.functions} | ${formatRanges(data.uncoveredLines) || '-'} | ${data.uncoveredBranchLines.join(', ') || '-'}`);
  }
  return { ok: result.testsPassed, testsPassed: result.testsPassed, thresholdsMet: result.thresholdsMet, total: result.summary?.total ?? 0, passed: result.summary?.passed ?? 0, reported: selected.length };
}

try {
  const options = parse(process.argv.slice(2));
  const outcome = await { test, typecheck, coverage }[options.command](options);
  console.log(`\n[run-tests] RESULT ${JSON.stringify({ workspace: options.workspace, command: options.command, ...outcome })}`);
  process.exitCode = outcome.ok ? 0 : 1;
} catch (error) {
  if (!(error instanceof UsageError)) throw error;
  console.error(error.message);
  console.log(`\n[run-tests] RESULT ${JSON.stringify({ ok: false, usageError: true })}`);
  process.exitCode = 2;
}
