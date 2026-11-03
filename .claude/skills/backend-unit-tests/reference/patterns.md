# Backend test patterns

Every snippet follows the conventions in `../SKILL.md` and runs against the
current code base. Adapt names. Don't copy blindly.

## Router with a stubbed store

```ts
import express from 'express';
import request from 'supertest';
import { it, expect, vi } from 'vitest';
import { createTodosRouter } from '../src/features/todos/router.ts';
import type { TodoStore } from '../src/features/todos/types.ts';
import { todo } from './fixture.ts';

function setup(overrides: Partial<TodoStore> = {}) {
  const repository = {
    list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(),
    ...overrides,
  } satisfies TodoStore;
  const app = express();
  app.use(express.json());
  app.use('/api/todos', createTodosRouter(repository));
  return { app, repository };
}

it('returns 404 when the task does not exist', async () => {
  const { app, repository } = setup({ get: vi.fn().mockResolvedValue(null) });
  const response = await request(app).get('/api/todos/5');
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Task not found.' });
  expect(repository.get).toHaveBeenCalledWith(5);
});

it.each(['0', 'abc', '1.5'])('rejects invalid id %s before calling the store', async (id) => {
  const { app, repository } = setup();
  expect((await request(app).get(`/api/todos/${id}`)).status).toBe(422);
  expect(repository.get).not.toHaveBeenCalled();
});
```

If `TodoStore` gains a method, add it to the `setup()` stub. Otherwise
`satisfies TodoStore` fails the typecheck, which is the point.

## App factory with a fake database

```ts
import request from 'supertest';
import { afterEach, it, expect, vi } from 'vitest';
import { createApp } from '../src/factory.ts';
import type { Database } from '../src/features/todos/types.ts';

afterEach(() => vi.restoreAllMocks());

function fakeDatabase(todo: Record<string, unknown> = {}) {
  return { todo: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]), ...todo } } as unknown as Database;
}

it('maps malformed JSON to 422', async () => {
  const response = await request(createApp(fakeDatabase()))
    .post('/api/todos').set('Content-Type', 'application/json').send('{"title":');
  expect(response.status).toBe(422);
  expect(response.body).toEqual({ detail: 'Invalid JSON.' });
});

it('hides unexpected errors behind a generic 500', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const app = createApp(fakeDatabase({ findMany: vi.fn().mockRejectedValue(new Error('boom')) }));
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ detail: 'Internal Server Error' });
  expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
});
```

Oversized body: `.send({ title: 'x', description: 'x'.repeat(200_000) })` → 413
`{ detail: 'Request body too large.' }`.

## Environment-dependent config

```ts
import { afterEach, it, expect, vi } from 'vitest';
import { resolveDatabaseUrl } from '../src/core/config.ts';

const parts = { POSTGRES_USER: 'user', POSTGRES_PASSWORD: 'p@ss word', POSTGRES_HOST: 'db', DB_PORT: '5433', POSTGRES_DB: 'taskly' };

function stubConnection(values: Record<string, string> = parts) {
  vi.stubEnv('DATABASE_URL', '');
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
}
afterEach(() => vi.unstubAllEnvs());

it('builds an encoded URL from the individual variables', () => {
  stubConnection();
  expect(resolveDatabaseUrl()).toBe('postgresql://user:p%40ss%20word@db:5433/taskly');
});

it.each(Object.keys(parts))('requires %s', (name) => {
  stubConnection({ ...parts, [name]: '' });
  expect(() => resolveDatabaseUrl()).toThrow(`Missing environment variable: ${name}`);
});
```

## Raw SQL helper

```ts
it('creates the todos table idempotently', async () => {
  const $executeRaw = vi.fn().mockResolvedValue(0);
  await initialize({ $executeRaw } as unknown as Database);
  const [strings] = $executeRaw.mock.calls[0];
  expect(strings.join('')).toContain('CREATE TABLE IF NOT EXISTS todos');
});
```

## Module mocks for lifecycle code

```ts
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';

vi.mock('../src/core/database.ts', () => ({ createDatabase: vi.fn(), initialize: vi.fn() }));
vi.mock('../src/core/config.ts', () => ({ resolveDatabaseUrl: vi.fn(() => 'postgresql://test') }));
vi.mock('../src/factory.ts', () => ({ createApp: vi.fn() }));

import { createDatabase, initialize } from '../src/core/database.ts';
import { createApp } from '../src/factory.ts';
import { start } from '../src/core/lifespan.ts';

function fakeServer(port = 8123) {
  const server = Object.assign(new EventEmitter(), {
    address: () => ({ port }),
    close: vi.fn((callback: () => void) => callback()),
  });
  return server;
}
```

Wire `createApp` to return `{ listen: vi.fn((port, host, ready) => { queueMicrotask(ready); return server; }) }`.
Spy on `process.once` with `vi.spyOn(process, 'once').mockImplementation(() => process)`
so the test can capture the shutdown handler and call it without sending real
signals. Silence `console.log` with a spy.

`main.ts` runs `start()` at import time. Mock `../src/core/lifespan.ts`, then
`vi.resetModules()` and `await import('../src/main.ts')` in each test. To check
that a rejection sets `process.exitCode = 1`, save and restore `process.exitCode`
in `afterEach`, and flush the promise with `await vi.waitFor(...)`.
