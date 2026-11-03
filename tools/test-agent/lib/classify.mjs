import path from 'node:path/posix';

// Paths outside this character set are never handed to the agent. This keeps
// file names from smuggling instructions or shell syntax into the prompt.
export const SAFE_PATH = /^[\w@+.-]+(?:\/[\w@+.-]+)*$/;

// First match wins. Mirrors the coverage include/exclude rules in
// backend/vitest.config.ts and frontend/vite.config.ts.
const RULES = [
  { pattern: /^backend\/src\/generated\//, skip: 'generated Prisma client' },
  { pattern: /^backend\/tests\/.+\.ts$/, kind: 'test', workspace: 'backend' },
  { pattern: /^frontend\/src\/.+\.test\.tsx?$/, kind: 'test', workspace: 'frontend' },
  { pattern: /^frontend\/src\/test\/.+\.tsx?$/, kind: 'test', workspace: 'frontend' },
  { pattern: /\.d\.ts$|(?:^|\/)(?:[^/]+\.)?types\.ts$/, skip: 'type declarations only' },
  { pattern: /(?:^|\/)index\.tsx?$/, skip: 'barrel re-exports' },
  { pattern: /\.stories\.tsx?$/, skip: 'Storybook story' },
  { pattern: /^frontend\/src\/design-system\//, skip: 'design system primitive (excluded from coverage, documented in Storybook)' },
  { pattern: /^frontend\/src\/main\.tsx$/, skip: 'application bootstrap (excluded from coverage)' },
  { pattern: /^frontend\/src\/(?:features\/todos\/api\/queryKeys|lib\/queryClient)\.ts$/, skip: 'static configuration (excluded from coverage)' },
  { pattern: /(?:^|\/)(?:[^/]+\.)?constants\.tsx?$/, skip: 'constants only' },
  { pattern: /^backend\/src\/.+\.ts$/, kind: 'source', workspace: 'backend' },
  { pattern: /^frontend\/src\/.+\.tsx?$/, kind: 'source', workspace: 'frontend' },
];

/** @returns {{ kind: 'source'|'test'|'other', workspace?: string, reason?: string }} */
export function classify(file) {
  if (!SAFE_PATH.test(file)) return { kind: 'other', reason: 'unsupported characters in path' };
  for (const rule of RULES) {
    if (!rule.pattern.test(file)) continue;
    if (rule.skip) return { kind: 'other', reason: rule.skip };
    return { kind: rule.kind, workspace: rule.workspace };
  }
  return { kind: 'other', reason: 'not unit-testable source (docs, config, styles or tooling)' };
}

const stripExtension = (file) => file.replace(/\.(?:[cm]?[jt]sx?)$/, '');

/** Module specifiers referenced by a test file: imports, dynamic imports and vi.mock targets. */
export function moduleSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bvi\.(?:mock|doMock|importActual)\(\s*['"]([^'"]+)['"]/g,
  ];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  return [...specifiers];
}

/** Repo-relative module paths (without extension) that a test file imports. */
export function importedModules(testFile, source) {
  return moduleSpecifiers(source)
    .filter((specifier) => specifier.startsWith('.'))
    .map((specifier) => stripExtension(path.normalize(path.join(path.dirname(testFile), specifier))))
    .flatMap((module) => [module, `${module}/index`]);
}

/** Test files (from `tests`, a map of path → contents) that import `sourceFile`. */
export function findRelatedTests(sourceFile, tests) {
  const module = stripExtension(sourceFile);
  return Object.entries(tests)
    .filter(([testFile, contents]) => importedModules(testFile, contents).includes(module))
    .map(([testFile]) => testFile)
    .sort();
}

/** Where a new test for `sourceFile` should go, following each workspace's convention. */
export function suggestTestFile(sourceFile, workspace, relatedTests, allFiles = []) {
  const base = path.basename(stripExtension(sourceFile));
  if (workspace === 'frontend') {
    return `${stripExtension(sourceFile)}${sourceFile.endsWith('.tsx') ? '.test.tsx' : '.test.ts'}`;
  }
  const flat = `backend/tests/${base}.test.ts`;
  if (relatedTests.includes(flat)) return flat;
  const collision = allFiles.includes(flat) && !relatedTests.includes(flat);
  if (!collision) return flat;
  const nested = path.dirname(sourceFile.replace(/^backend\/src\//, ''));
  return `backend/tests/${nested}/${base}.test.ts`;
}

// Higher scores go first when the target limit truncates the list.
export function riskScore(target) {
  const file = target.file;
  let score = 0;
  if (/\/(?:validators|mappers|repository|router|utils\/|lib\/|http)/.test(file)) score += 30;
  else if (/\/hooks\//.test(file) || /\/api\//.test(file) || /\/core\//.test(file)) score += 20;
  else if (/\/components\//.test(file)) score += 10;
  if (target.status === 'added') score += 5;
  if (!target.relatedTests.length) score += 5;
  const uncovered = target.coverage?.uncoveredChangedLineCount ?? 0;
  return score + Math.min(uncovered, 40);
}
