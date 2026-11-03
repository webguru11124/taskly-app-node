#!/usr/bin/env node
// Renders the sticky PR comment from the plan, the agent run summary and the
// independent verification result. Agent-authored text is sanitised; every
// pass/fail number comes from verification.json, not from the agent.
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { formatRanges } from '../../.claude/skills/run-unit-tests/scripts/lib.mjs';
import { appendSummary, isMain, readJsonFile } from './lib/cli.mjs';
import { codePath, details, duration, safeText, table } from './lib/markdown.mjs';

export const MARKER = '<!-- unit-test-agent:sticky -->';

const icon = (ok) => (ok === undefined || ok === null ? '–' : ok ? '✅' : '❌');
const pct = (value) => (Number.isFinite(value) ? `${value}%` : 'n/a');

export function headline({ plan, agent, verification, publish, setup }) {
  if (setup === 'missing-credentials') return '⚠️ **Not configured.** Add the `CLAUDE_CODE_OAUTH_TOKEN` (or `ANTHROPIC_API_KEY`) repository secret to enable the agent. The analysis below ran anyway.';
  if (!plan) return '❌ **The change analysis failed.** See the workflow logs.';
  if (plan.decision !== 'run') return `⏭️ **No test changes needed.** ${safeText(plan.reason)}.`;
  if (!agent || ['failed', 'timeout', 'incomplete'].includes(agent.status)) {
    if (!verification || verification.status === 'no-changes') return `❌ **The agent run ${agent?.status ?? 'did not start'}.** ${agent?.error ? safeText(agent.error, 200) : 'See the workflow logs.'}`;
  }
  switch (verification?.status) {
    case 'no-changes': return 'ℹ️ **The agent analysed the change and decided no test changes were needed.** Its reasoning is below.';
    case 'rejected': return '🛑 **The generated changes violated the change policy and were discarded.** Nothing was committed.';
    case 'apply-failed': return '❌ **The generated patch did not apply to the PR head.** Nothing was committed.';
    case 'failed': return '❌ **The generated tests failed independent verification.** Nothing was committed. Download the `unit-test-agent-patch` artifact to inspect them.';
    case 'passed': {
      const files = verification.testFiles.length;
      const added = verification.testsAdded > 0 ? `, ${verification.testsAdded} new test(s)` : '';
      if (publish?.outcome === 'committed') return `✅ **${files} test file(s) created or updated${added}, verified independently and committed in ${publish.commit.slice(0, 7)}.**`;
      return `⚠️ **${files} test file(s) passed verification but were not committed:** ${safeText(publish?.reason ?? 'publish step did not run', 200)}. They are in the \`unit-test-agent-patch\` artifact.`;
    }
    default: return '❌ **Verification did not run.** See the workflow logs.';
  }
}

function analysisSection(plan, report) {
  if (!plan?.targets?.length) return '';
  const decisions = new Map((report?.decisions ?? []).map((decision) => [decision.file, decision]));
  const rows = plan.targets.map((target) => {
    const decision = decisions.get(target.file);
    const uncovered = target.coverage ? (formatRanges(target.coverage.uncoveredChangedLines) || 'none') : 'n/a';
    return [
      codePath(target.file),
      target.status,
      formatRanges(target.changedLines) || '–',
      uncovered,
      decision ? `**${safeText(decision.action, 10)}**: ${safeText(decision.reason, 220)}` : '–',
    ];
  });
  return `### Analysis\n\n${table(['Source file', 'Change', 'Changed lines', 'Uncovered before', 'Agent decision'], rows)}`;
}

function skippedSection(plan) {
  const entries = [...(plan?.covered ?? []), ...(plan?.skipped ?? [])];
  const deleted = (plan?.deleted ?? []).map((entry) => `- ${codePath(entry.file)} deleted${entry.orphanTests.length ? `; tests still importing it: ${entry.orphanTests.map(codePath).join(', ')}` : ''}`);
  const body = [...entries.map((entry) => `- ${codePath(entry.file)}: ${safeText(entry.reason, 160)}`), ...deleted].join('\n');
  return details(`Files not sent to the agent (${entries.length + deleted.length})`, body);
}

function agentSection(agent) {
  if (!agent || agent.status === 'skipped') return '';
  const tools = Object.entries(agent.toolCalls ?? {}).map(([name, count]) => `${name} ×${count}`).join(', ') || 'none';
  const lines = [
    '### Agent run',
    '',
    `**Skills used:** ${(agent.skillsUsed ?? []).map((skill) => `\`${safeText(skill, 60)}\``).join(' → ') || 'none'}`,
    `**Model:** ${safeText(agent.model ?? 'n/a', 60)} · **Turns:** ${agent.numTurns ?? 'n/a'} · **Duration:** ${duration(agent.durationMs)} · **Status:** ${safeText(agent.status, 20)}`,
    `**Tool calls:** ${tools}`,
    `**Blocked by permission policy:** ${(agent.permissionDenials ?? []).length ? agent.permissionDenials.map((denial) => `${safeText(denial.tool, 30)} ${codePath(denial.target)}`).join('; ') : 'nothing'}`,
  ];
  if (agent.report?.summary) lines.push('', `> ${safeText(agent.report.summary, 700)}`);
  const runs = (agent.testRuns ?? []).map((run) => `- \`${safeText(run.args, 140)}\` → ${run.ok ? 'ok' : 'failed'}${Number.isFinite(run.total) ? ` (${run.passed}/${run.total})` : ''}`);
  if (runs.length) lines.push('', details(`Test runs during the agent session (${runs.length})`, runs.join('\n')));
  return lines.join('\n');
}

function testsSection(verification, report) {
  if (!verification?.testFiles?.length) return '';
  const claimed = new Map((report?.testFiles ?? []).map((file) => [file.path, file]));
  const rows = verification.testFiles.map((file) => [
    codePath(file.path),
    file.status === 'A' ? 'created' : 'updated',
    file.tests ?? 'n/a',
    (claimed.get(file.path)?.covers ?? []).slice(0, 6).map((item) => safeText(item, 90)).join('<br>') || '–',
  ]);
  return `### Tests\n\n${table(['Test file', 'Change', 'Tests in file', 'Covers (agent summary)'], rows)}`;
}

function verificationSection(verification) {
  if (!verification || verification.status === 'no-changes') return '';
  const lines = ['### Independent verification', ''];
  const guard = verification.guard;
  if (guard) {
    lines.push(`${icon(guard.passed)} **Change policy:** ${guard.files.length} file(s), +${guard.addedLines} lines, ${guard.passed ? 'test files only' : `${guard.violations.length} violation(s)`}`);
    for (const violation of guard.violations.slice(0, 10)) lines.push(`  - ${codePath(violation.file ?? '*')}${violation.line ? `:${violation.line}` : ''} ${safeText(violation.rule, 40)}: ${safeText(violation.message, 160)}`);
    for (const warning of guard.warnings.slice(0, 5)) lines.push(`  - ⚠️ ${codePath(warning.file)}: ${safeText(warning.message, 160)}`);
  }
  const workspaces = Object.entries(verification.workspaces ?? {});
  if (workspaces.length) {
    lines.push('', table(['Check', ...workspaces.map(([name]) => name)], [
      ['Typecheck (`tsc --noEmit`)', ...workspaces.map(([, entry]) => `${icon(entry.typecheck.ok)}${entry.typecheck.ok ? '' : ` ${entry.typecheck.errors} error(s)`}`)],
      ['Full test suite', ...workspaces.map(([, entry]) => `${icon(entry.tests.ok)} ${entry.tests.passed}/${entry.tests.total} passed`)],
      ['New tests', ...workspaces.map(([, entry]) => (entry.testsAdded === null ? 'n/a' : `+${entry.testsAdded}`))],
      ['Reruns of changed test files', ...workspaces.map(([, entry]) => (entry.flaky.runs ? `${icon(entry.flaky.ok)} ${entry.flaky.ok ? `${entry.flaky.runs}× stable` : 'unstable'}` : '–'))],
      ['Coverage thresholds (vitest config)', ...workspaces.map(([, entry]) => (entry.coverageThresholdsMet === false ? '⚠️ not met' : entry.coverageThresholdsMet ? '✅' : '–'))],
    ]));
    const failures = workspaces.flatMap(([, entry]) => entry.tests.failures ?? []);
    if (failures.length) lines.push('', details(`Failing tests (${failures.length})`, failures.map((failure) => `- ${safeText(failure.file, 80)} › ${safeText(failure.name, 160)}: ${safeText(failure.message, 300)}`).join('\n')));
  }
  const coverageRows = (verification.targets ?? []).filter((target) => target.after).map((target) => {
    const total = target.changedExecutableLines ?? 0;
    const before = target.before ? `${total - target.before.uncoveredChangedLines}/${total}` : 'n/a';
    const after = `${total - target.after.uncoveredChangedLines}/${total}`;
    return [codePath(target.file), `${before} → **${after}**`, `${pct(target.before?.lines)} → ${pct(target.after.lines)}`, `${pct(target.before?.branches)} → ${pct(target.after.branches)}`];
  });
  if (coverageRows.length) lines.push('', table(['Target', 'Changed lines covered', 'File lines', 'File branches'], coverageRows));
  return lines.join('\n');
}

function findingsSection(report) {
  const findings = report?.findings ?? [];
  if (!findings.length) return '';
  const label = { bug: '🐞 Possible bug', risk: '⚠️ Risk', info: 'ℹ️ Note' };
  return `### Findings from the agent\n\n${findings.slice(0, 10).map((finding) => `- ${label[finding.severity] ?? 'ℹ️ Note'} in ${codePath(finding.file)}${Number.isInteger(finding.line) ? `:${finding.line}` : ''}: ${safeText(finding.description, 400)}`).join('\n')}\n\n<sub>Findings are the agent's opinion. They're not verified.</sub>`;
}

export function renderComment({ plan, agent, verification, publish, setup, runUrl, headSha }) {
  const sections = [
    MARKER,
    '## 🧪 Unit Test Agent',
    '',
    headline({ plan, agent, verification, publish, setup }),
    analysisSection(plan, agent?.report),
    skippedSection(plan),
    agentSection(agent),
    testsSection(verification, agent?.report),
    verificationSection(verification),
    findingsSection(agent?.report),
    `<sub>${runUrl ? `[Workflow run](${runUrl}) · ` : ''}head \`${String(headSha ?? plan?.head ?? '').slice(0, 7)}\` · updated ${new Date().toISOString().replace(/\.\d+Z$/, 'Z')} · add the \`test-agent:skip\` label to opt out</sub>`,
  ];
  return sections.filter(Boolean).join('\n\n');
}

async function main() {
  const { values } = parseArgs({
    options: {
      plan: { type: 'string', default: '.test-agent/plan.json' },
      agent: { type: 'string', default: '.test-agent/agent-run.json' },
      verification: { type: 'string', default: '.test-agent/verification.json' },
      publish: { type: 'string', default: '.test-agent/publish.json' },
      setup: { type: 'string', default: '' },
      out: { type: 'string', default: '.test-agent/comment.md' },
    },
  });
  const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;
  const markdown = renderComment({
    plan: readJsonFile(values.plan), agent: readJsonFile(values.agent), verification: readJsonFile(values.verification),
    publish: readJsonFile(values.publish), setup: values.setup, runUrl, headSha: process.env.HEAD_SHA,
  });
  writeFileSync(values.out, `${markdown}\n`);
  appendSummary(markdown.replace(MARKER, ''));
  console.log(markdown);
}

if (isMain(import.meta)) await main();
