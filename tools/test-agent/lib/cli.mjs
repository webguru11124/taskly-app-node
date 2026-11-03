import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** True when the module was started directly with `node <file>`. */
export function isMain(meta) {
  return Boolean(process.argv[1]) && meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

/** Appends single-line key=value pairs to $GITHUB_OUTPUT when running in Actions. */
export function appendOutput(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${String(value).replace(/[\r\n]+/g, ' ')}`);
  appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
}

export function appendSummary(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

export function readJsonFile(file, fallback = null) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}
