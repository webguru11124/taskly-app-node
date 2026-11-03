import { execFileSync } from 'node:child_process';

export function git(args, { cwd = process.cwd(), input } = {}) {
  return execFileSync('git', args, { cwd, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
}

const STATUS = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied', T: 'type-changed' };

/** Parses `git diff --name-status -z` output (rename/copy entries carry two paths). */
export function parseNameStatus(output) {
  const parts = output.split('\0').filter(Boolean);
  const changes = [];
  for (let index = 0; index < parts.length;) {
    const code = parts[index++];
    const kind = STATUS[code[0]] ?? 'unknown';
    if (code[0] === 'R' || code[0] === 'C') {
      changes.push({ status: kind, previous: parts[index++], file: parts[index++] });
    } else {
      changes.push({ status: kind, file: parts[index++] });
    }
  }
  return changes;
}

/**
 * Extracts changed line ranges on the new side of a `-U0` diff, keyed by
 * file. Pure deletions mark the line where content was removed so that the
 * surrounding behaviour still gets analysed.
 */
export function parseChangedLines(diff) {
  const files = {};
  let current = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim();
      current = target === '/dev/null' ? null : target.replace(/^b\//, '');
      if (current) files[current] ??= [];
      continue;
    }
    const hunk = current && /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      const range = count === 0 ? [Math.max(start, 1), Math.max(start, 1)] : [start, start + count - 1];
      files[current].push(range);
    }
  }
  return files;
}

export function changedFiles(base, head, { cwd } = {}) {
  return parseNameStatus(git(['diff', '--name-status', '-z', '-M', `${base}...${head}`], { cwd }));
}

export function changedLines(base, head, files, { cwd } = {}) {
  if (!files.length) return {};
  return parseChangedLines(git(['diff', '-U0', '--no-color', '-M', `${base}...${head}`, '--', ...files], { cwd }));
}

export function listFiles(ref, { cwd } = {}) {
  return git(['ls-tree', '-r', '--name-only', '-z', ref], { cwd }).split('\0').filter(Boolean);
}

export function readFileAt(ref, file, { cwd } = {}) {
  return git(['show', `${ref}:${file}`], { cwd });
}

export function resolveRef(ref, { cwd } = {}) {
  return git(['rev-parse', '--verify', `${ref}^{commit}`], { cwd }).trim();
}
