---
name: run-unit-tests
description: Run Taskly frontend or backend unit tests, type checks, and coverage through a sandboxed wrapper script, then triage failures and check for flaky tests. Use whenever tests, tsc, or coverage need to run, and to verify generated tests before reporting them.
---

# Run and verify unit tests

All test execution goes through one script. It validates its arguments, runs
the workspace's own Vitest or TypeScript binary with a **scrubbed environment**
(no tokens or API keys reach test code) and a timeout, trims the output, and
ends with one machine-readable line:

```text
[run-tests] RESULT {"workspace":"backend","command":"test","ok":true,"total":61,"passed":61,...}
```

Run it from the repository root:

```bash
node .claude/skills/run-unit-tests/scripts/run-tests.mjs <backend|frontend> <command> [options]
```

| Command | Use |
| --- | --- |
| `test [files...]` | Run the given test files (workspace-relative like `tests/router.test.ts`, or repo-relative like `frontend/src/lib/http.test.ts`). With no files, run the whole suite. |
| `test <files...> --runs 3` | Repeat the run to detect flaky tests. `"flaky": true` in RESULT means the outcome changed between runs. |
| `typecheck` | `tsc --noEmit` for the workspace. Tests are type-checked too. Vitest does **not** type-check, so always run this. |
| `coverage [--source src/a.ts --source src/b.ts]` | Whole suite with coverage. Repeat `--source` for each file. Prints line/branch/function % and **uncovered line ranges** for the given sources (default: every file below 100 %). |

Only test-file and source-file paths that match the workspace patterns are
accepted. Anything else is refused with exit code 2 and `"usageError": true`.
Don't try other ways to run code. Apart from read-only commands, everything
except this script is denied.

## Verification loop

For every workspace you changed:

1. `typecheck`. Fix type errors in your tests first. They often point to a
   wrong mock shape.
2. `test <your files>`. Iterate until green, at most **3 fix attempts per
   file**.
3. `test` (whole suite). Make sure your mocks don't leak into other files.
4. `coverage --source <targets>`. Compare the uncovered ranges with the plan's
   `changedLines`, and add tests for meaningful gaps.
5. `test <your files> --runs 3`. They must be stable.

## Triage a failure

Read the assertion diff and decide what kind of failure it is:

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `Cannot find module`, or `is not a function` on a mocked import | Wrong relative path in `vi.mock`, or a missing export in the mock factory | Fix the test |
| `Unable to find role/label` | Wrong query or accessible name. Read the component's JSX. | Fix the test |
| Wrong value from your own fixture or stub | Test setup bug | Fix the test |
| Leaked state: passes alone, fails in the full suite | Missing `restoreAllMocks`, `unstubAllEnvs`, `useRealTimers`, or `unstubAllGlobals` | Add cleanup |
| Source behaves differently from its name, types, docs, or API contract | Possible production bug | Don't assert the buggy behaviour. Remove that case and report a `bug` finding with file, line, expected, and actual. |
| Pre-existing test fails without your changes (see plan `baseline`) | The PR changed behaviour | Follow `test-impact-analysis`: update only if the change is clearly intentional |

Stop iterating on a file after 3 failed attempts. Revert your change to it and
record the reason in the report's `verification.notes`.

## Reporting

Fill the report's `verification` fields from the RESULT lines you actually saw
in your last runs: `typecheckPassed`, `testsPassed`, and the per-workspace
`runs` entries (`workspace`, `command`, `passed`, `failed`). Never estimate or
invent numbers. CI repeats the whole verification independently and compares.
