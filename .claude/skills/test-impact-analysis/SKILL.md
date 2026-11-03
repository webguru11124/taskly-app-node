---
name: test-impact-analysis
description: Decide which changed or under-tested source files in the Taskly monorepo need new or updated unit tests, and which can be skipped, with a reason for each. Use at the start of any test-generation task, in a PR or for local backfill, before writing tests.
---

# Test impact analysis

Turn a set of changed or under-tested files into a list of decisions:
`write`, `update`, or `skip`. Every decision needs a one-sentence reason that a
reviewer can check.

## 1. Get the target list

**In CI** your prompt names a plan file (usually `.test-agent/plan.json`)
produced by `tools/test-agent/plan.mjs`. Read it first. It is generated
deterministically from `git diff` and a coverage run of the PR head, so trust
its file lists and line numbers. Its shape:

```jsonc
{
  "mode": "pr",                      // or "backfill"
  "targets": [{
    "workspace": "backend",          // or "frontend"
    "file": "backend/src/features/todos/router.ts",
    "status": "modified",            // added | modified | renamed
    "changedLines": [[12, 30]],      // inclusive ranges on the head version
    "relatedTests": ["backend/tests/router.test.ts"],
    "suggestedTestFile": "backend/tests/router.test.ts",
    "testsChangedInPr": [],          // tests the author already touched
    "coverage": {                    // baseline for the PR head, may be null
      "lines": 44, "branches": 16.7,
      "uncoveredLines": [[22, 22], [25, 29]],
      "uncoveredChangedLines": [[25, 29]]
    }
  }],
  "skipped": [{ "file": "README.md", "reason": "not a source file" }],
  "deleted": [{ "file": "...", "orphanTests": ["..."] }],
  "baseline": {                      // the PR head before your changes
    "backend": {
      "passed": true, "total": 118, "failed": 0, "failedTests": [],
      "typecheck": { "ok": false, "errors": 1, "sample": ["tests/router.test.ts(16,46): error TS2345: ..."] }
    }
  }
}
```

**Locally**, without a plan, generate one:
`node tools/test-agent/plan.mjs --base origin/main --head HEAD --with-coverage`
(it writes `.test-agent/plan.json`). You can also take the file list from the
user's request and use the `run-unit-tests` coverage command for line data.

## 2. Inspect each target

For every target:

1. Read the source file. Focus on `changedLines`, but read enough context to
   understand the behaviour.
2. Read every file in `relatedTests` and `testsChangedInPr`.
3. Ask: *what observable behaviour did this change add or alter, and does an
   existing test fail if that behaviour breaks?*

## 3. Decide

| Decision | When |
| --- | --- |
| `write` | New module with logic and no test file. Or an existing module with no test file that has uncovered changed lines. |
| `update` | A test file exists, but changed lines are uncovered or the existing assertions no longer describe the new behaviour (renamed fields, new branches, new error paths). Also for baseline failures caused by an *intentional* behaviour change. |
| `skip` | Type-only or barrel (`index.ts`) changes. Styling, design tokens, or stories. Pure wiring with no branches (`main.ts`, `main.tsx`). Generated code. Changed lines already covered by passing tests whose assertions still match the behaviour. Also skip when the author already added adequate tests in this PR. |

Rules of thumb:

- **Coverage is a signal, not the goal.** A covered line can still be
  unasserted, and an uncovered line can be trivial. Judge the behaviour.
- **Baseline failures need judgement.** If `baseline.<workspace>.passed` is
  false, work out whether the source change is intentional (update the
  expectation) or a regression (report a `bug` finding and leave the
  assertion alone). When the intent is unclear, treat it as a finding.
- **Baseline type errors in tests** (`baseline.<workspace>.typecheck.ok` is
  false, with errors in test files) usually mean an interface grew and a test
  stub or fixture wasn't updated. Vitest doesn't type-check, so such tests can
  still "pass". Fix the stub (an `update` decision) when the source change
  explains it. Type errors in production files are not yours to fix: report
  them as a `risk` finding.
- **Deleted modules.** If `deleted[].orphanTests` is non-empty, those tests will
  fail to import. You may not delete files, so report it as a `risk` finding.
- **Budget.** If there are more targets than you can handle well, prioritise by
  risk: domain logic and validation, then data access and API handlers, then
  hooks and state, then interactive components, then presentational
  components. Report the rest as `skip` with reason "deferred: budget".

## 4. Record

Keep the decisions. They go into the final report's `decisions` array:

```json
{ "file": "backend/src/features/todos/router.ts", "action": "update",
  "testFile": "backend/tests/router.test.ts",
  "reason": "New DELETE /completed route (lines 25-29) is uncovered; router tests exist." }
```

For each workspace with a `write` or `update` decision, continue with
`backend-unit-tests` or `frontend-unit-tests`.
