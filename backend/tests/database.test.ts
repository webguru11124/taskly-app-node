import { it, expect, vi } from 'vitest';
import type { Database } from '../src/features/todos/types.ts';

const { PrismaPg, PrismaClient } = vi.hoisted(() => ({
  PrismaPg: vi.fn(function PrismaPg() {}),
  PrismaClient: vi.fn(function PrismaClient() {}),
}));
vi.mock('@prisma/adapter-pg', () => ({ PrismaPg }));
vi.mock('../src/generated/prisma/client.ts', () => ({ PrismaClient }));

import { createDatabase, initialize } from '../src/core/database.ts';

it('creates a Prisma client over the pg adapter with a 10 s connection timeout', () => {
  const database = createDatabase('postgresql://test:test@localhost:5432/test');
  expect(PrismaPg).toHaveBeenCalledWith({ connectionString: 'postgresql://test:test@localhost:5432/test', connectionTimeoutMillis: 10000 });
  expect(PrismaClient).toHaveBeenCalledWith({ adapter: PrismaPg.mock.instances[0] });
  expect(database).toBe(PrismaClient.mock.instances[0]);
});
it('creates the todos table idempotently with its constraints and no parameters', async () => {
  const $executeRaw = vi.fn().mockResolvedValue(0);
  await initialize({ $executeRaw } as unknown as Database);
  expect($executeRaw).toHaveBeenCalledOnce();
  const [strings, ...values] = $executeRaw.mock.calls[0];
  expect(values).toEqual([]);
  const sql = strings.join('').replace(/\s+/g, ' ');
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS todos (');
  expect(sql).toContain('id SERIAL PRIMARY KEY');
  expect(sql).toContain('title VARCHAR(120) NOT NULL CONSTRAINT todo_title_not_empty CHECK (length(title) >= 1)');
  expect(sql).toContain("description VARCHAR(2000) NOT NULL DEFAULT ''");
  expect(sql).toContain("priority VARCHAR(6) NOT NULL DEFAULT 'medium' CONSTRAINT todo_priority CHECK (priority IN ('low', 'medium', 'high'))");
  expect(sql).toContain('due_date DATE,');
  expect(sql).toContain('completed BOOLEAN NOT NULL DEFAULT FALSE');
  expect(sql).toContain('created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL');
});
it('propagates schema creation failures', async () => {
  const $executeRaw = vi.fn().mockRejectedValue(new Error('permission denied'));
  await expect(initialize({ $executeRaw } as unknown as Database)).rejects.toThrow('permission denied');
});
