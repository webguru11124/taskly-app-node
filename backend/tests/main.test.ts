import { afterEach, beforeEach, it, expect, vi, type Mock } from 'vitest';
import type { start as startApi } from '../src/core/lifespan.ts';

vi.mock('../src/core/lifespan.ts', () => ({ start: vi.fn() }));

const initialExitCode = process.exitCode;
beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = initialExitCode;
});

// main.ts starts the API as an import side effect, so import it fresh in every test.
async function importMain(prepare: (start: Mock<typeof startApi>) => void) {
  const { start } = await import('../src/core/lifespan.ts');
  const mocked = vi.mocked(start);
  mocked.mockReset();
  prepare(mocked);
  await import('../src/main.ts');
  return mocked;
}

it('starts the API on import and leaves the exit code alone on success', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const start = await importMain((mock) => mock.mockResolvedValue({} as Awaited<ReturnType<typeof startApi>>));
  expect(start).toHaveBeenCalledOnce();
  await start.mock.results[0].value;
  expect(process.exitCode).toBe(initialExitCode);
  expect(error).not.toHaveBeenCalled();
});
it('logs startup failures and sets a failing exit code', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const failure = new Error('Database unavailable');
  const start = await importMain((mock) => mock.mockRejectedValue(failure));
  expect(start).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(process.exitCode).toBe(1));
  expect(error).toHaveBeenCalledWith('Cannot start Taskly App Node API:', failure);
});
