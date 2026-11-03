import { fileURLToPath } from 'node:url';
import { afterEach, it, expect, vi } from 'vitest';

// Keep the developer's root .env out of the tests; the variables are stubbed below.
const { config } = vi.hoisted(() => ({ config: vi.fn() }));
vi.mock('dotenv', () => ({ default: { config } }));

import { resolveDatabaseUrl } from '../src/core/config.ts';

const parts = { POSTGRES_USER: 'user', POSTGRES_PASSWORD: 'p@ss word', POSTGRES_HOST: 'db', DB_PORT: '5433', POSTGRES_DB: 'taskly' };

function stubConnection(values: Record<string, string> = parts, databaseUrl = '') {
  vi.stubEnv('DATABASE_URL', databaseUrl);
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
}
afterEach(() => vi.unstubAllEnvs());

it('loads the repository root .env quietly on import', () => {
  expect(config).toHaveBeenCalledWith({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
});
it('builds an encoded URL from the individual variables', () => {
  stubConnection();
  expect(resolveDatabaseUrl()).toBe('postgresql://user:p%40ss%20word@db:5433/taskly');
});
it('encodes the database name', () => {
  stubConnection({ ...parts, POSTGRES_DB: 'task/ly db' });
  expect(resolveDatabaseUrl()).toBe('postgresql://user:p%40ss%20word@db:5433/task%2Fly%20db');
});
it.each(Object.keys(parts))('requires %s when no URL is given', (name) => {
  stubConnection({ ...parts, [name]: '' });
  expect(() => resolveDatabaseUrl()).toThrow(`Missing environment variable: ${name}`);
});
it.each([
  ['postgresql://env:secret@envhost:5432/envdb', 'postgresql://env:secret@envhost:5432/envdb'],
  ['postgresql+psycopg://env:secret@envhost:5432/envdb', 'postgresql://env:secret@envhost:5432/envdb'],
])('prefers DATABASE_URL over the individual variables: %s', (databaseUrl, expected) => {
  stubConnection(parts, databaseUrl);
  expect(resolveDatabaseUrl()).toBe(expected);
});
it.each([
  ['postgresql://override@host/db', 'postgresql://override@host/db'],
  ['postgresql+psycopg://override@host/db', 'postgresql://override@host/db'],
])('prefers an explicit override over the environment: %s', (override, expected) => {
  stubConnection(parts, 'postgresql://env@envhost/envdb');
  expect(resolveDatabaseUrl(override)).toBe(expected);
});
it('falls back to the environment when the override is empty', () => {
  stubConnection(parts, 'postgresql://env@envhost/envdb');
  expect(resolveDatabaseUrl('')).toBe('postgresql://env@envhost/envdb');
});
it('only rewrites the driver prefix at the start of the URL', () => {
  stubConnection(parts, 'postgresql://user@host/db?application_name=postgresql+psycopg:app');
  expect(resolveDatabaseUrl()).toBe('postgresql://user@host/db?application_name=postgresql+psycopg:app');
});
