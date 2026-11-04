# Taskly App Node

Full-stack task list. Two independent npm workspaces. The root `package.json` only marks the repository root and installs nothing:

- `backend/`: Node ≥22 ESM, TypeScript, Express 5, Zod 4, Prisma 7 (PostgreSQL). Tests in `backend/tests/*.test.ts` (Vitest + Supertest), with sources imported with the `.ts` extension.
- `frontend/`: React 19, TypeScript, TanStack Query 5, styled-components design system (`src/design-system`). Tests are colocated as `*.test.ts(x)` (Vitest + Testing Library). Prettier style: no semicolons, single quotes.

## Commands (run inside the workspace)

- `npm ci`, `npm run typecheck`, `npm test`, `npm run test:coverage`
- frontend only: `npm run format:check`, `npm run build`
- tooling tests (repo root): `node --test "tools/test-agent/test/*.test.mjs"`

## Unit test agent

- Agent: `.claude/agents/unit-test-agent.md`
- Skills: `.claude/skills/{test-impact-analysis,backend-unit-tests,frontend-unit-tests,run-unit-tests}`
- CI orchestration and policy: `tools/test-agent/`, `.github/workflows/unit-test-agent.yml`
- Design and usage: `SOLUTION.md`

Unit tests must not need PostgreSQL, the network, or a local `.env`.
