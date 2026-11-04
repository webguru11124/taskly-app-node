import express from 'express';
import request from 'supertest';
import { it, expect, vi } from 'vitest';
import { createTodosRouter } from '../src/features/todos/router.ts';
import { todo } from './fixture.ts';

function setup() {
  const repository = { list: vi.fn().mockResolvedValue([todo]), create: vi.fn().mockResolvedValue(todo), get: vi.fn(), update: vi.fn(), delete: vi.fn(), duplicate: vi.fn() };
  const app = express();
  app.use(express.json());
  app.use('/api/todos', createTodosRouter(repository));
  return { app, repository };
}
it('lists tasks from the repository', async () => {
  const { app, repository } = setup();
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(200);
  expect(response.body).toEqual([todo]);
  expect(repository.list).toHaveBeenCalledOnce();
});
it('creates tasks with trimmed input and defaults', async () => {
  const { app, repository } = setup();
  const response = await request(app).post('/api/todos').send({ title: '  Plan the sprint  ', priority: 'high' });
  expect(response.status).toBe(201);
  expect(response.body).toEqual(todo);
  expect(repository.create).toHaveBeenCalledWith({ title: 'Plan the sprint', description: '', priority: 'high', due_date: null, completed: false });
});
it.each([{ title: '  ' }, { title: 'x'.repeat(121) }, { title: 'Task', priority: 'urgent' }, { title: 'Task', due_date: '2026-02-30' }])(
  'rejects invalid create input without calling the repository: %j', async (payload) => {
    const { app, repository } = setup();
    expect((await request(app).post('/api/todos').send(payload)).status).toBe(422);
    expect(repository.create).not.toHaveBeenCalled();
  },
);
it('gets a task by its numeric ID', async () => {
  const { app, repository } = setup();
  repository.get.mockResolvedValue(todo);
  const response = await request(app).get('/api/todos/1');
  expect(response.status).toBe(200);
  expect(response.body).toEqual(todo);
  expect(repository.get).toHaveBeenCalledWith(1);
});
it('updates tasks with a validated, trimmed patch', async () => {
  const { app, repository } = setup();
  const updated = { ...todo, title: 'Renamed', completed: true };
  repository.update.mockResolvedValue(updated);
  const response = await request(app).patch('/api/todos/1').send({ title: '  Renamed  ', completed: true });
  expect(response.status).toBe(200);
  expect(response.body).toEqual(updated);
  expect(repository.update).toHaveBeenCalledWith(1, { title: 'Renamed', completed: true });
});
it('deletes tasks with an empty 204 response', async () => {
  const { app, repository } = setup();
  repository.delete.mockResolvedValue(true);
  const response = await request(app).delete('/api/todos/1');
  expect(response.status).toBe(204);
  expect(response.text).toBe('');
  expect(repository.delete).toHaveBeenCalledWith(1);
});
it('duplicates a task and responds 201 with the copy', async () => {
  const { app, repository } = setup();
  const copy = { ...todo, id: 2, title: 'Task (copy)' };
  repository.duplicate.mockResolvedValue(copy);
  const response = await request(app).post('/api/todos/1/duplicate');
  expect(response.status).toBe(201);
  expect(response.body).toEqual(copy);
  expect(repository.duplicate).toHaveBeenCalledWith(1);
});
it('returns 404 when duplicating a missing task', async () => {
  const { app, repository } = setup();
  repository.duplicate.mockResolvedValue(null);
  const response = await request(app).post('/api/todos/5/duplicate');
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Task not found.' });
});
it('rejects an invalid id when duplicating', async () => {
  const { app, repository } = setup();
  expect((await request(app).post('/api/todos/abc/duplicate')).status).toBe(422);
  expect(repository.duplicate).not.toHaveBeenCalled();
});
it.each([
  ['get', 'get', null], ['patch', 'update', null], ['delete', 'delete', false],
] as const)('returns 404 when %s targets a missing task', async (method, store, missing) => {
  const { app, repository } = setup();
  repository[store].mockResolvedValue(missing);
  const response = await request(app)[method]('/api/todos/5').send({ completed: true });
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Task not found.' });
  expect(repository[store].mock.calls[0][0]).toBe(5);
});
it.each([{}, { title: '' }, { title: null }, { completed: 'yes' }, { due_date: '2026-02-30' }, { id: 2 }])(
  'rejects invalid patches without calling the repository: %j', async (payload) => {
    const { app, repository } = setup();
    const response = await request(app).patch('/api/todos/1').send(payload);
    expect(response.status).toBe(422);
    expect(response.body.detail).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.any(String) })]));
    expect(repository.update).not.toHaveBeenCalled();
  },
);
it.each(['0', '-1', '1.5', 'abc', '9007199254740992'].flatMap((id) => (['get', 'patch', 'delete'] as const).map((method) => [method, id] as const)))(
  '%s rejects invalid id %s before calling the repository', async (method, id) => {
    const { app, repository } = setup();
    const response = await request(app)[method](`/api/todos/${id}`).send({ title: 'Task' });
    expect(response.status).toBe(422);
    expect(response.body.detail).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.any(String) })]));
    expect(repository.get).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.delete).not.toHaveBeenCalled();
  },
);
