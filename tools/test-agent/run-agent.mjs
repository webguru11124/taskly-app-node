#!/usr/bin/env node
// Runs the custom `unit-test-agent` (.claude/agents) headless through the
// Claude Code CLI with a locked-down permission policy, and records what it
// did. It never commits or pushes: the caller turns the working-tree changes
// into a patch that a separate job verifies.
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { formatRanges } from '../../.claude/skills/run-unit-tests/scripts/lib.mjs';
import { appendOutput, isMain, readJsonFile } from './lib/cli.mjs';
import { SAFE_PATH } from './lib/classify.mjs';
import { createStreamCollector } from './lib/stream.mjs';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));

// Environment variables the Claude Code process may see. GitHub tokens and
// everything else on the runner are dropped. Claude Code additionally scrubs
// its own credentials from the shells it spawns (SUBPROCESS_ENV_SCRUB).
const ENV_PASSTHROUGH = /^(?:PATH|HOME|USER|SHELL|LANG|LC_ALL|TZ|TMPDIR|TEMP|TMP|SYSTEMROOT|WINDIR|COMSPEC|USERPROFILE|APPDATA|LOCALAPPDATA|XDG_[A-Z_]+|CLAUDE_CODE_OAUTH_TOKEN|ANTHROPIC_API_KEY)$/i;

export function agentEnv(source = process.env) {
  // Empty values are dropped too: Actions renders an unset secret as "".
  const env = Object.fromEntries(Object.entries(source).filter(([name, value]) => value && ENV_PASSTHROUGH.test(name)));
  return {
    ...env,
    CI: 'true',
    CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_AUTOUPDATER: '1',
  };
}

// Actions masks secrets in job logs, but not in artifacts, and the artifacts of
// a public repository are public.
export function createRedactor(source = process.env) {
  const secrets = [source.CLAUDE_CODE_OAUTH_TOKEN, source.ANTHROPIC_API_KEY].filter(Boolean);
  return (text) => secrets.reduce((current, secret) => current.replaceAll(secret, '[REDACTED]'), text);
}

// Claude Code reports `default` instead of `dontAsk` when subprocess scrubbing is
// on. With --permission-prompts none, both deny whatever isn't allow-listed. Any
// other mode would weaken the policy, so the runner stops the session instead.
const ACCEPTED_PERMISSION_MODES = ['dontAsk', 'default'];

export function permissionModeProblem(mode) {
  return ACCEPTED_PERMISSION_MODES.includes(mode) ? null : `Refused to run in permission mode "${mode}".`;
}

/** The most useful single line of a crash's stderr, which also holds source excerpts. */
export function failureReason(stderr) {
  const lines = stderr.split('\n').map((line) => line.trim()).filter(Boolean);
  const reason = lines.find((line) => /^error:/i.test(line)) ?? lines.at(-1) ?? '';
  return reason.replace(/^error:\s*/i, '').slice(0, 300) || null;
}

export function buildPrompt(plan, planPath) {
  const targets = plan.targets.filter((target) => SAFE_PATH.test(target.file));
  const lines = [
    `You are running non-interactively in CI (${plan.mode === 'pr' ? `pull request, head ${String(plan.head).slice(0, 12)}` : 'coverage backfill'}).`,
    `The deterministic test plan is at \`${planPath}\`. Read it first. It lists ${targets.length} target file(s) in: ${plan.workspaces.join(', ')}.`,
    '',
    'Targets:',
    ...targets.map((target) => {
      const parts = [`${target.status}`];
      if (target.changedLines.length) parts.push(`changed lines ${formatRanges(target.changedLines)}`);
      if (target.coverage) parts.push(`uncovered changed lines ${formatRanges(target.coverage.uncoveredChangedLines) || 'none'}`);
      parts.push(`existing tests: ${target.relatedTests.join(', ') || 'none'}`);
      return `- ${target.file} (${parts.join('; ')})`;
    }),
  ];
  const failing = Object.entries(plan.baseline ?? {}).filter(([, baseline]) => !baseline.passed);
  if (failing.length) {
    lines.push('', `Baseline test failures before your changes: ${failing.map(([workspace, baseline]) => `${workspace} (${baseline.failed} failing)`).join(', ')}. See plan.baseline.`);
  }
  const untyped = Object.entries(plan.baseline ?? {}).filter(([, baseline]) => baseline.typecheck?.ok === false);
  if (untyped.length) {
    lines.push('', `Baseline type errors before your changes: ${untyped.map(([workspace, baseline]) => `${workspace} (${baseline.typecheck.errors})`).join(', ')}. See plan.baseline.<workspace>.typecheck.sample.`);
  }
  lines.push(
    '',
    'Follow your workflow: invoke the `test-impact-analysis` skill, then `backend-unit-tests` and/or `frontend-unit-tests` for the workspaces you change, then `run-unit-tests` before your first test command.',
    'Edit only test files, using the Edit and Write tools. If no test changes are appropriate, make none and explain why in `decisions`.',
    'Before the report, complete these for every workspace you changed, one command per call: `typecheck`, the whole suite, `coverage --source` for its targets, and `test <your test files> --runs 3`.',
    'Finish with the structured report.',
  );
  return lines.join('\n');
}

export function claudeArgs({ model, maxTurns, settingsFile, schema }) {
  return [
    '-p',
    '--agent', 'unit-test-agent',
    '--model', model,
    '--max-turns', String(maxTurns),
    '--setting-sources', 'project',
    '--settings', settingsFile,
    '--permission-mode', 'dontAsk',
    '--permission-prompts', 'none',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--disallowedTools', 'WebFetch,WebSearch,Agent,NotebookEdit',
    '--output-format', 'stream-json',
    '--verbose',
    '--json-schema', schema,
  ];
}

export async function runAgent({ plan, planPath, outDir, model, maxTurns, timeoutMinutes, bin = process.env.CLAUDE_BIN || 'claude', cwd = process.cwd() }) {
  mkdirSync(outDir, { recursive: true });
  if (plan.decision !== 'run') return { status: 'skipped', reason: plan.reason };

  const schema = JSON.stringify(JSON.parse(readFileSync(path.join(TOOLS_DIR, 'agent-report.schema.json'), 'utf8')));
  const settingsFile = path.relative(cwd, path.join(TOOLS_DIR, 'claude-settings.json')).replaceAll('\\', '/');
  const prompt = buildPrompt(plan, planPath);
  writeFileSync(path.join(outDir, 'agent-prompt.md'), `${prompt}\n`);

  const redact = createRedactor();
  const log = createWriteStream(path.join(outDir, 'agent-log.jsonl'));
  const started = Date.now();
  let refused = null;
  const collector = createStreamCollector({
    repoRoot: cwd,
    onProgress: (message) => console.log(`[agent +${Math.round((Date.now() - started) / 1000)}s] ${message}`),
    onInit: ({ permissionMode }) => {
      refused = permissionModeProblem(permissionMode);
      if (refused) child.kill('SIGTERM');
    },
  });

  const child = spawn(bin, claudeArgs({ model, maxTurns, settingsFile, schema }), {
    cwd, env: agentEnv(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  child.stdin.end(prompt);
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => { log.write(`${redact(line)}\n`); collector.handleLine(line); });

  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMinutes * 60_000);
  const exitCode = await new Promise((resolve) => {
    child.on('error', (error) => { stderr += String(error); resolve(127); });
    child.on('close', (code) => resolve(code ?? 1));
  });
  clearTimeout(timer);
  await new Promise((resolve) => log.end(resolve));

  const summary = collector.summary();
  if (refused) summary.status = 'failed';
  else if (timedOut) summary.status = 'timeout';
  else if (exitCode !== 0 && summary.status === 'completed') summary.status = 'failed';
  const failed = summary.status !== 'completed';
  const error = refused ?? summary.error ?? (timedOut ? `No result after ${timeoutMinutes} minutes.` : failed ? failureReason(stderr) : null);
  return JSON.parse(redact(JSON.stringify({ ...summary, error, exitCode, stderr: failed ? stderr.trim() : '' })));
}

async function main() {
  const { values } = parseArgs({
    options: {
      plan: { type: 'string', default: '.test-agent/plan.json' },
      out: { type: 'string', default: '.test-agent' },
      model: { type: 'string', default: process.env.TEST_AGENT_MODEL || 'sonnet' },
      'max-turns': { type: 'string', default: process.env.TEST_AGENT_MAX_TURNS || '80' },
      'timeout-minutes': { type: 'string', default: process.env.TEST_AGENT_TIMEOUT_MINUTES || '25' },
      'print-prompt': { type: 'boolean', default: false },
    },
  });
  const plan = readJsonFile(values.plan);
  if (!plan) throw new Error(`Cannot read plan ${values.plan}`);
  if (values['print-prompt']) { console.log(buildPrompt(plan, values.plan)); return; }

  const run = await runAgent({
    plan, planPath: values.plan.replaceAll('\\', '/'), outDir: values.out, model: values.model,
    maxTurns: Number(values['max-turns']), timeoutMinutes: Number(values['timeout-minutes']),
  });
  writeFileSync(path.join(values.out, 'agent-run.json'), `${JSON.stringify(run, null, 2)}\n`);
  console.log(`Agent ${run.status}: ${run.numTurns ?? '?'} turns, skills [${(run.skillsUsed ?? []).join(', ')}], files written: ${(run.filesWritten ?? []).length}, permission denials: ${(run.permissionDenials ?? []).length}`);
  if (run.status !== 'completed' && run.status !== 'skipped') console.log(`::warning title=Unit Test Agent::Agent run ${run.status}${run.error ? `: ${run.error}` : ''}`);
  appendOutput({ status: run.status });
}

if (isMain(import.meta)) await main();
