#!/usr/bin/env node
// Last step of the workflow. Failures are reported through artifacts so that
// the PR comment always gets posted; this turns them into a red run, so that a
// dead agent can't hide behind a green check.
import { isMain, readJsonFile } from './lib/cli.mjs';
import { runProblem } from './render-comment.mjs';

if (isMain(import.meta)) {
  const problem = runProblem({
    plan: readJsonFile('.test-agent/plan.json'),
    agent: readJsonFile('.test-agent/agent-run.json'),
    verification: readJsonFile('.test-agent/verification.json'),
    publish: readJsonFile('.test-agent/publish.json'),
    setup: process.env.SETUP,
  });
  if (problem) console.log(`::error title=Unit Test Agent::${problem.replace(/[\r\n]+/g, ' ')}`);
  else console.log('Unit Test Agent: nothing to report.');
  process.exitCode = problem ? 1 : 0;
}
