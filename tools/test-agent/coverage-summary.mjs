#!/usr/bin/env node
// Prints a Vitest json-summary coverage report as a Markdown table for the
// GitHub job summary: `node coverage-summary.mjs <title> <coverage-summary.json>`.
import { readJsonFile } from './lib/cli.mjs';

const [title = 'Coverage', file = 'coverage/coverage-summary.json'] = process.argv.slice(2);
const summary = readJsonFile(file);
if (!summary?.total) {
  console.log(`### ${title} coverage\n\nNo coverage summary found at \`${file}\`.`);
} else {
  const metrics = ['statements', 'branches', 'functions', 'lines'];
  const row = (name, data) => `| ${name} | ${metrics.map((metric) => `${data[metric].pct}%`).join(' | ')} |`;
  const files = Object.entries(summary)
    .filter(([name]) => name !== 'total')
    .map(([name, data]) => row(`\`${name.replace(/^.*?\/(src\/)/, '$1')}\``, data));
  console.log([
    `### ${title} coverage`, '',
    `| File | ${metrics.join(' | ')} |`, `| --- | ${metrics.map(() => '---').join(' | ')} |`,
    row('**All files**', summary.total), ...files, '',
  ].join('\n'));
}
