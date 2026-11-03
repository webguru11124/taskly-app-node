import { readFileSync } from 'node:fs';
import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import { afterEach, it, expect, vi } from 'vitest';
import { createApp } from '../src/factory.ts';
import type { Database } from '../src/features/todos/types.ts';
import { record, todo } from './fixture.ts';

afterEach(() => vi.restoreAllMocks());

function fakeDatabase(delegate: Record<string, unknown> = {}) {
  const todoDelegate = { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([record]), create: vi.fn(), ...delegate };
  return { database: { todo: todoDelegate } as unknown as Database, todo: todoDelegate };
}

it('mounts the health and todo routes on the shared database', async () => {
  const { database, todo: delegate } = fakeDatabase();
  const app = createApp(database);
  const health = await request(app).get('/api/health');
  expect(health.status).toBe(200);
  expect(health.body).toEqual({ status: 'ok' });
  expect(delegate.findFirst).toHaveBeenCalledOnce();
  const list = await request(app).get('/api/todos');
  expect(list.status).toBe(200);
  expect(list.body).toEqual([todo]);
  expect(delegate.findMany).toHaveBeenCalledOnce();
});
it('does not advertise the framework', async () => {
  const response = await request(createApp(fakeDatabase().database)).get('/api/health');
  expect(response.headers['x-powered-by']).toBeUndefined();
});
it.each([['get', '/missing'], ['get', '/api/unknown'], ['put', '/api/todos/1']] as const)(
  'returns a JSON 404 for %s %s', async (method, path) => {
    const response = await request(createApp(fakeDatabase().database))[method](path);
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ detail: 'Not Found' });
  },
);
it('maps malformed JSON to 422 without calling the repository', async () => {
  const { database, todo: delegate } = fakeDatabase();
  const response = await request(createApp(database))
    .post('/api/todos').set('Content-Type', 'application/json').send('{"title":');
  expect(response.status).toBe(422);
  expect(response.body).toEqual({ detail: 'Invalid JSON.' });
  expect(delegate.create).not.toHaveBeenCalled();
});
it('rejects bodies over the 100 kB limit with 413', async () => {
  const { database, todo: delegate } = fakeDatabase();
  const response = await request(createApp(database)).post('/api/todos').send({ title: 'x', description: 'x'.repeat(200_000) });
  expect(response.status).toBe(413);
  expect(response.body).toEqual({ detail: 'Request body too large.' });
  expect(delegate.create).not.toHaveBeenCalled();
});
it.each([
  ['an Error', new Error('Database unavailable')],
  ['a non-Error value', 'Database unavailable'],
  ['an error with an unrelated type', Object.assign(new Error('Query failed'), { type: 'database.timeout' })],
])('hides %s behind a generic 500 and logs it', async (label, failure) => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { database } = fakeDatabase({ findMany: vi.fn().mockRejectedValue(failure) });
  const response = await request(createApp(database)).get('/api/todos');
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ detail: 'Internal Server Error' });
  expect(error).toHaveBeenCalledWith(failure);
});
it('delegates errors to Express when the response has already started', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const failure = new Error('Database unavailable');
  const delegated = vi.fn();
  const outer = express();
  outer.use((req, res, next) => { res.type('text/plain').write('partial'); next(); });
  outer.use(createApp(fakeDatabase({ findMany: vi.fn().mockRejectedValue(failure) }).database));
  outer.use(((caught, req, res, next) => { delegated(caught); res.end(); }) satisfies ErrorRequestHandler);
  const response = await request(outer).get('/api/todos');
  expect(response.status).toBe(200);
  expect(response.text).toBe('partial');
  expect(delegated).toHaveBeenCalledWith(failure);
  expect(error).not.toHaveBeenCalled();
});
it('serves the OpenAPI specification and Swagger UI', async () => {
  const specification = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'));
  const app = createApp(fakeDatabase().database);
  const spec = await request(app).get('/openapi.json');
  expect(spec.status).toBe(200);
  expect(spec.body).toEqual(specification);
  const docs = await request(app).get('/docs/');
  expect(docs.status).toBe(200);
  expect(docs.type).toBe('text/html');
  expect(docs.text).toContain('swagger-ui');
  const init = await request(app).get('/docs/swagger-ui-init.js');
  expect(init.status).toBe(200);
  expect(init.text).toContain(specification.info.title);
});
