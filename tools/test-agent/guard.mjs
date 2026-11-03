#!/usr/bin/env node
// Re-checks the staged diff against the change policy without executing any
// code. The publish job runs it right before committing, so the commit can
// only contain changes that pass the same policy the verify job enforced.
import { isMain } from './lib/cli.mjs';
import { checkStagedChanges } from './lib/policy.mjs';

if (isMain(import.meta)) {
  const result = checkStagedChanges();
  for (const violation of result.violations) {
    console.log(`::error file=${violation.file ?? ''},line=${violation.line ?? 1}::${violation.rule}: ${violation.message}`);
  }
  for (const warning of result.warnings) console.log(`::warning file=${warning.file}::${warning.message}`);
  console.log(`Policy ${result.passed ? 'passed' : 'FAILED'}: ${result.files.length} file(s), +${result.addedLines} lines.`);
  process.exitCode = result.passed ? 0 : 1;
}
