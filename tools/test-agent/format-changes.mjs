#!/usr/bin/env node
// Applies the workspace's formatter to the agent's staged test files. The agent
// has no formatter, and CI's format check would otherwise fail on its commit.
// Prettier only parses these files, so this step runs none of the agent's code.
import { WORKSPACES, runPrettier } from '../../.claude/skills/run-unit-tests/scripts/lib.mjs';
import { isMain } from './lib/cli.mjs';
import { git } from './lib/git.mjs';
import { ALLOWED_PATHS } from './lib/policy.mjs';

export async function formatStagedChanges({ cwd = process.cwd(), format = runPrettier } = {}) {
  const staged = git(['diff', '--cached', '--name-only', '--diff-filter=AM', 'HEAD'], { cwd }).split('\n').filter(Boolean);
  const formatted = [];
  for (const [workspace, config] of Object.entries(WORKSPACES)) {
    if (!config.prettier) continue;
    const prefix = `${config.dir}/`;
    const files = staged
      .filter((file) => file.startsWith(prefix) && ALLOWED_PATHS.some((pattern) => pattern.test(file)))
      .map((file) => file.slice(prefix.length));
    if (!files.length) continue;
    const result = await format(workspace, files, { write: true, root: cwd });
    // Not fatal here: verification checks the formatting and reports it.
    if (!result.ok) console.log(`::warning title=Unit Test Agent::Prettier failed in ${workspace}: ${result.output.slice(-300)}`);
    else formatted.push(...files.map((file) => prefix + file));
  }
  return formatted;
}

if (isMain(import.meta)) {
  const formatted = await formatStagedChanges();
  console.log(`Formatted ${formatted.length} file(s).`);
}
