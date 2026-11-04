---
name: backend-unit-tests
description: Conventions and proven patterns for writing Vitest unit tests for the Taskly backend (Express 5, Zod 4, Prisma 7 with the pg adapter, Supertest). Use when creating or updating tests under backend/tests for code in backend/src.
---

# Backend unit tests (`backend/`)

Stack: Node ≥22 ESM, TypeScript (strict), Express 5, Zod 4, Prisma 7,
Vitest 4, Supertest. Tests never need PostgreSQL.

## Where tests live

- One flat file per source module: `backend/src/features/todos/router.ts` →
  `backend/tests/router.test.ts`, and `backend/src/core/config.ts` →
  `backend/tests/config.test.ts`. If the basename is already taken by another
  module, use a subfolder that mirrors `src/` (`backend/tests/core/config.test.ts`).
- Shared fixtures are in `backend/tests/fixture.ts` (`record` is a Prisma row,
  `todo` is the API JSON). Reuse them, and only *add* exports to that file.
  Changing existing exports breaks other tests.
- `vitest.config.ts` includes only `tests/**/*.test.ts`.

## File conventions

- Import test APIs explicitly (globals are off):
  `import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';`
- Import source with the **`.ts` extension**:
  `import { createTodosRouter } from '../src/features/todos/router.ts';`
  (`allowImportingTsExtensions` is on, and existing tests do this.)
- Style: semicolons, single quotes, 2-space indent, compact tests. Use
  `it.each` tables for validation matrices.
- Types: `import type { Database, TodoStore } from '../src/features/todos/types.ts';`.
  Cast partial fakes with `as unknown as Database`. Never use `any` when a
  narrower cast works.
- Tests are type-checked (`npm run typecheck` includes `tests/`), so they must
  compile.

## Patterns by layer

Full, working snippets for each layer are in
[reference/patterns.md](reference/patterns.md). Read the section you need.

| Layer | Approach |
| --- | --- |
| Zod validators (`validators.ts`) | Call `schema.parse` / `safeParse` directly. Use tables of valid and invalid inputs, including boundaries (120/121 title, 2000/2001 description, leap days). |
| Mappers (`mappers.ts`) | Pure functions: check input→output and that the input isn't mutated. |
| Repository (`repository.ts`) | Build the real client with `createDatabase('postgresql://test:test@localhost:5432/test')` (it doesn't connect), then `vi.spyOn(database.todo, 'findMany').mockResolvedValue([...])`. Assert the Prisma call arguments *and* the mapped result. |
| Routers (`router.ts`, `api/health.ts`) | Mount the router on a minimal `express()` app with `express.json()`. Stub the `TodoStore` with `vi.fn()` and drive it with `supertest`. Assert status, body, and repository calls, and that invalid input never reaches the repository. |
| App factory (`factory.ts`) | `createApp(fakeDatabase)` with a fake object that has only the delegate methods used. Covers 404, malformed JSON (422), oversized body (413), unexpected errors (500, with `console.error` silenced by a spy), `/openapi.json`, and `x-powered-by` removal. |
| Config (`core/config.ts`) | `vi.stubEnv(...)` for **every** variable the code reads, including `DATABASE_URL=''`, because a developer's root `.env` may be loaded. Restore with `vi.unstubAllEnvs()`. |
| Database helpers (`core/database.ts`) | `initialize(fake)` with `{ $executeRaw: vi.fn() }`. The tagged template passes the SQL strings array as the first argument. |
| Lifecycle (`core/lifespan.ts`, `main.ts`) | `vi.mock` the collaborators (`database.ts`, `config.ts`, `factory.ts`, or `lifespan.ts`), fake the HTTP server, and spy on `process.once` / `process.exit`. For modules with import-time side effects, use `vi.resetModules()` plus `await import(...)` inside the test. |

## Express 5 specifics

- Async handlers that reject are forwarded to error middleware automatically.
  When a router is tested alone (without `createApp`), a rejected repository
  call becomes Express's default 500 HTML response.
- `router.param('id', ...)` validates `:id` with `idSchema`. Invalid ids return
  422 with `{ detail: issues[] }` before the handler runs.
- Body limit is the `express.json()` default (100 kB). A larger payload returns
  413 through `createApp`'s error handler.

## Don'ts

- Don't open real sockets except through `supertest(app)`, which uses an
  ephemeral port. Don't `listen()` on fixed ports.
- Don't touch the real database or call `$connect()` unmocked.
- Don't rely on the order of `Object.keys` in Zod error messages. Check
  `success`, status codes, or specific issue paths.
- Don't lower the coverage thresholds in `vitest.config.ts`
  (`validators.ts` and `mappers.ts` must stay at 100 %).

## Running

Invoke the `run-unit-tests` skill before you run anything. It has the commands
and the checks you must complete.
