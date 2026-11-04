// Folds Claude Code `--output-format stream-json` events into a run summary:
// which skills and tools were used, which files were written, the RESULT line
// of every test run, permission denials, and the final structured report.

const RESULT_LINES = /\[run-tests\] RESULT (\{.*\})/g;

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part === 'string' ? part : part?.text ?? '')).join('\n');
  return '';
}

function skillName(input = {}) {
  const raw = input.skill ?? input.name ?? input.command ?? '';
  return String(raw).replace(/^\//, '').split(/\s+/)[0];
}

export function describeToolUse(name, input = {}) {
  if (name === 'Skill') return `Skill → ${skillName(input)}`;
  if (name === 'Bash') return `Bash ${String(input.command ?? '').replace(/^node \.claude\/skills\/run-unit-tests\/scripts\/run-tests\.mjs/, 'run-tests').slice(0, 160)}`;
  if (['Read', 'Edit', 'Write', 'MultiEdit'].includes(name)) return `${name} ${input.file_path ?? ''}`;
  if (name === 'Grep' || name === 'Glob') return `${name} ${input.pattern ?? ''}`;
  return name;
}

export function createStreamCollector({ repoRoot = '', onProgress = () => {}, onInit = () => {} } = {}) {
  const state = {
    init: null, result: null, skillsUsed: [], toolCalls: {}, filesWritten: new Set(), testRuns: [],
    pendingRuns: new Map(), events: 0, parseErrors: 0,
  };
  const relative = (file) => String(file ?? '').replaceAll('\\', '/').replace(`${repoRoot.replaceAll('\\', '/')}/`, '');

  function handle(event) {
    state.events += 1;
    if (event.type === 'system' && event.subtype === 'init') {
      state.init = { model: event.model, permissionMode: event.permissionMode, tools: event.tools, claudeCodeVersion: event.claude_code_version };
      onProgress(`session started (model ${event.model}, permission mode ${event.permissionMode})`);
      onInit(state.init);
      return;
    }
    if (event.type === 'assistant') {
      for (const block of event.message?.content ?? []) {
        if (block.type !== 'tool_use') continue;
        state.toolCalls[block.name] = (state.toolCalls[block.name] ?? 0) + 1;
        if (block.name === 'Skill') {
          const name = skillName(block.input);
          if (name && !state.skillsUsed.includes(name)) state.skillsUsed.push(name);
        }
        if (['Edit', 'Write', 'MultiEdit'].includes(block.name) && block.input?.file_path) state.filesWritten.add(relative(block.input.file_path));
        if (block.name === 'Bash' && /run-tests\.mjs/.test(block.input?.command ?? '')) state.pendingRuns.set(block.id, block.input.command);
        onProgress(describeToolUse(block.name, { ...block.input, file_path: relative(block.input?.file_path) }));
      }
      return;
    }
    if (event.type === 'user') {
      for (const block of event.message?.content ?? []) {
        if (block.type !== 'tool_result' || !state.pendingRuns.has(block.tool_use_id)) continue;
        const command = state.pendingRuns.get(block.tool_use_id);
        state.pendingRuns.delete(block.tool_use_id);
        // A single command line can chain several runs, each with its own RESULT.
        const outcomes = [...textOf(block.content).matchAll(RESULT_LINES)].flatMap((match) => {
          try { return [JSON.parse(match[1])]; } catch { return []; }
        });
        const args = command.replace(/^node \S+run-tests\.mjs\s*/, '');
        if (!outcomes.length) {
          state.testRuns.push({ ok: false, unparsed: true, args });
          onProgress('  ↳ no RESULT line');
        }
        for (const outcome of outcomes) {
          state.testRuns.push({ ...outcome, args: outcomes.length === 1 ? args : `${outcome.workspace} ${outcome.command}` });
          onProgress(`  ↳ ${outcome.workspace} ${outcome.command}: ${outcome.ok ? 'ok' : 'FAILED'}${outcome.total !== undefined ? ` (${outcome.passed}/${outcome.total} passed)` : ''}`);
        }
      }
      return;
    }
    if (event.type === 'result') state.result = event;
  }

  function handleLine(line) {
    if (!line.trim()) return;
    try { handle(JSON.parse(line)); } catch { state.parseErrors += 1; }
  }

  function summary() {
    const result = state.result;
    return {
      status: !result ? 'incomplete' : result.is_error || result.subtype !== 'success' ? 'failed' : 'completed',
      subtype: result?.subtype ?? null,
      terminalReason: result?.terminal_reason ?? null,
      error: result?.is_error ? String(result.result ?? '').slice(0, 500) : null,
      model: state.init?.model ?? null,
      claudeCodeVersion: state.init?.claudeCodeVersion ?? null,
      permissionMode: state.init?.permissionMode ?? null,
      numTurns: result?.num_turns ?? null,
      durationMs: result?.duration_ms ?? null,
      costUsd: result?.total_cost_usd ?? null,
      skillsUsed: state.skillsUsed,
      toolCalls: state.toolCalls,
      filesWritten: [...state.filesWritten].sort(),
      testRuns: state.testRuns,
      permissionDenials: (result?.permission_denials ?? []).map((denial) => ({
        tool: denial.tool_name,
        target: String(denial.tool_input?.file_path ?? denial.tool_input?.command ?? denial.tool_input?.url ?? '').slice(0, 200),
      })),
      report: result?.structured_output ?? null,
      resultText: result && !result.is_error ? String(result.result ?? '').slice(0, 6000) || null : null,
      events: state.events,
      parseErrors: state.parseErrors,
    };
  }

  return { handle, handleLine, summary };
}
