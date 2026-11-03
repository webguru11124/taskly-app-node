import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import { it, expect, vi } from 'vitest';
import { createHealthRouter } from '../src/api/health.ts';
import type { Database } from '../src/features/todos/types.ts';

function setup(findFirst = vi.fn().mockResolvedValue(null)) {
  const app = express();
  app.use('/api', createHealthRouter({ todo: { findFirst } } as unknown as Database));
  app.use(((error, req, res, next) => res.status(503).json({ error: error.message })) satisfies ErrorRequestHandler);
  return { app, findFirst };
}

it.each([null, { id: 1 }])('reports ok after a lightweight database query (row: %j)', async (row) => {
  const { app, findFirst } = setup(vi.fn().mockResolvedValue(row));
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
  expect(findFirst).toHaveBeenCalledWith({ select: { id: true } });
});
it('forwards database failures to the error handler instead of reporting ok', async () => {
  const { app } = setup(vi.fn().mockRejectedValue(new Error('Database unavailable')));
  const response = await request(app).get('/api/health');
  expect(response.status).toBe(503);
  expect(response.body).toEqual({ error: 'Database unavailable' });
});
