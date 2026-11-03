// The authoritative policy for agent-generated changes. It runs outside the
// agent (in the verify and publish jobs) on the staged diff, so it holds even
// if the agent's own permission rules were misconfigured or bypassed.
import { git } from './git.mjs';

export const ALLOWED_PATHS = [
  /^backend\/tests\/(?:[\w.-]+\/)*[\w.-]+\.ts$/,
  /^frontend\/src\/(?:[\w.-]+\/)*[\w.-]+\.test\.tsx?$/,
  /^frontend\/src\/test\/(?:[\w.-]+\/)*[\w.-]+\.tsx?$/,
];

export const LIMITS = { maxFiles: 25, maxAddedLines: 4000, maxFileBytes: 100_000 };

export const CONTENT_RULES = [
  {
    id: 'focused-or-skipped-test',
    pattern: /\b(?:it|test|describe|suite)\s*\.\s*(?:only|skip|todo|skipIf|runIf|fails)\b|\b[xf](?:it|test|describe)\s*\(/,
    message: 'focused, skipped, todo or expected-failure tests are not allowed',
  },
  { id: 'type-check-suppression', pattern: /@ts-(?:ignore|nocheck)\b/, message: '@ts-ignore / @ts-nocheck are not allowed' },
  { id: 'process-spawning', pattern: /['"](?:node:)?(?:child_process|worker_threads|cluster)['"]/, message: 'tests must not spawn processes or threads' },
  { id: 'raw-network', pattern: /['"](?:node:)?(?:net|dgram|dns|tls|http2)['"]/, message: 'tests must not use raw network modules (use supertest)' },
  { id: 'external-host', pattern: /\bhttps?:\/\/(?!(?:localhost|127\.0\.0\.1|example\.(?:com|org|test))(?:[:/'"`]|$))/i, message: 'tests must not reference external hosts' },
  {
    id: 'credential-access',
    pattern: /process\.env\.(?:\w*(?:TOKEN|SECRET|API_KEY)\w*|(?:GITHUB|ANTHROPIC|CLAUDE|ACTIONS|RUNNER)_\w+)|(?:Object\.(?:keys|entries|values)|JSON\.stringify)\(\s*process\.env\s*\)|\.\.\.process\.env\b/,
    message: 'tests must not read or dump credentials from the environment',
  },
  { id: 'dynamic-code', pattern: /\beval\s*\(|\bnew\s+Function\s*\(/, message: 'eval / new Function are not allowed' },
];

const isAllowedPath = (file) => ALLOWED_PATHS.some((pattern) => pattern.test(file));
const isSharedFixture = (file) => /^frontend\/src\/test\//.test(file) || (/^backend\/tests\//.test(file) && !file.endsWith('.test.ts'));

/** Splits a unified diff into per-file added and removed lines. */
export function parseDiffLines(diff) {
  const files = {};
  let current = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) { current = null; continue; }
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim();
      current = target === '/dev/null' ? null : target.replace(/^b\//, '');
      if (current) files[current] ??= { added: [], removed: [] };
      continue;
    }
    if (line.startsWith('--- ')) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line);
    if (hunk) { if (current) files[current].nextLine = Number(hunk[1]); continue; }
    if (!current) continue;
    if (line.startsWith('+')) files[current].added.push({ line: files[current].nextLine++, text: line.slice(1) });
    else if (line.startsWith('-')) files[current].removed.push(line.slice(1));
    else if (line.startsWith(' ')) files[current].nextLine++;
  }
  return files;
}

/**
 * Evaluates the policy on already-collected change data so it can be unit
 * tested without git. `entries` come from `git diff --cached --raw`.
 */
export function evaluatePolicy({ entries, numstat, diff }) {
  const violations = [];
  const warnings = [];
  const files = [];
  if (entries.length > LIMITS.maxFiles) violations.push({ rule: 'too-many-files', message: `${entries.length} files changed (limit ${LIMITS.maxFiles})` });

  for (const entry of entries) {
    const { file, status, newMode } = entry;
    files.push({ path: file, status });
    if (!isAllowedPath(file)) violations.push({ rule: 'path-not-allowed', file, message: 'only test files and test fixtures may change' });
    if (status !== 'A' && status !== 'M') violations.push({ rule: 'change-type', file, message: `change type ${status} is not allowed (only add or modify)` });
    if (status !== 'D' && newMode && newMode !== '100644') violations.push({ rule: 'file-mode', file, message: `file mode ${newMode} is not allowed` });
    const stats = numstat[file];
    if (stats?.binary) violations.push({ rule: 'binary', file, message: 'binary files are not allowed' });
    if (stats && !stats.binary && stats.bytes > LIMITS.maxFileBytes) violations.push({ rule: 'file-size', file, message: `file is ${stats.bytes} bytes (limit ${LIMITS.maxFileBytes})` });
    if (isSharedFixture(file) && status === 'M') warnings.push({ file, message: 'shared test fixture modified; other tests depend on it' });
  }

  const totalAdded = Object.values(numstat).reduce((sum, stats) => sum + (stats.added ?? 0), 0);
  if (totalAdded > LIMITS.maxAddedLines) violations.push({ rule: 'too-many-lines', message: `${totalAdded} lines added (limit ${LIMITS.maxAddedLines})` });

  for (const [file, lines] of Object.entries(parseDiffLines(diff))) {
    for (const { line, text } of lines.added) {
      for (const rule of CONTENT_RULES) {
        if (rule.pattern.test(text)) violations.push({ rule: rule.id, file, line, message: rule.message });
      }
    }
    const removedAssertions = lines.removed.filter((text) => /\bexpect\s*\(/.test(text)).length;
    const addedAssertions = lines.added.filter(({ text }) => /\bexpect\s*\(/.test(text)).length;
    if (removedAssertions > 0) warnings.push({ file, message: `${removedAssertions} existing assertion line(s) changed or removed; review that expectations were not weakened` });
    const status = entries.find((entry) => entry.file === file)?.status;
    if (status === 'A' && file.includes('.test.') && addedAssertions === 0) violations.push({ rule: 'no-assertions', file, message: 'new test file contains no expect() assertions' });
  }

  return { passed: violations.length === 0, files, violations, warnings, addedLines: totalAdded };
}

/** Parses `git diff --raw -z` output. */
export function parseRaw(output) {
  const parts = output.split('\0');
  const entries = [];
  for (let index = 0; index < parts.length;) {
    const match = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z])\d*$/.exec(parts[index++]);
    if (!match) continue;
    const [, oldMode, newMode, status] = match;
    const file = parts[index++];
    if (status === 'R' || status === 'C') entries.push({ status, previous: file, file: parts[index++], oldMode, newMode });
    else entries.push({ status, file, oldMode, newMode });
  }
  return entries;
}

export function parseNumstat(output, sizes = {}) {
  const stats = {};
  for (const line of output.split('\n').filter(Boolean)) {
    const [added, removed, file] = line.split('\t');
    stats[file] = added === '-' ? { binary: true } : { added: Number(added), removed: Number(removed), bytes: sizes[file] ?? 0 };
  }
  return stats;
}

/** Checks the staged changes in `cwd` against the policy. */
export function checkStagedChanges({ cwd = process.cwd() } = {}) {
  const entries = parseRaw(git(['diff', '--cached', '--raw', '-z', '--no-renames', '--no-abbrev'], { cwd }));
  const sizes = {};
  for (const entry of entries) {
    if (entry.status === 'D') continue;
    try { sizes[entry.file] = Number(git(['cat-file', '-s', `:${entry.file}`], { cwd }).trim()); } catch { sizes[entry.file] = 0; }
  }
  const numstat = parseNumstat(git(['diff', '--cached', '--numstat', '--no-renames'], { cwd }), sizes);
  const diff = git(['diff', '--cached', '--no-color', '--no-renames', '-U0'], { cwd });
  return evaluatePolicy({ entries, numstat, diff });
}
