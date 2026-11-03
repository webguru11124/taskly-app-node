import { EventEmitter } from 'node:events';
import { afterEach, it, expect, vi } from 'vitest';

vi.mock('../src/core/database.ts', () => ({ createDatabase: vi.fn(), initialize: vi.fn() }));
vi.mock('../src/core/config.ts', () => ({ resolveDatabaseUrl: vi.fn(() => 'postgresql://test') }));
vi.mock('../src/factory.ts', () => ({ createApp: vi.fn() }));

import { createDatabase, initialize } from '../src/core/database.ts';
import { createApp } from '../src/factory.ts';
import { start } from '../src/core/lifespan.ts';

const initialExitCode = process.exitCode;
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  process.exitCode = initialExitCode;
});

function setup(port = '9123') {
  vi.stubEnv('API_PORT', port);
  const database = { $connect: vi.fn().mockResolvedValue(undefined), $disconnect: vi.fn().mockResolvedValue(undefined) };
  const server = Object.assign(new EventEmitter(), { address: vi.fn(() => ({ port: 8123 })), close: vi.fn() });
  const listen = vi.fn((port: number, host: string, ready: () => void) => { queueMicrotask(ready); return server; });
  vi.mocked(createDatabase).mockReturnValue(database as unknown as ReturnType<typeof createDatabase>);
  vi.mocked(initialize).mockResolvedValue(undefined);
  vi.mocked(createApp).mockReturnValue({ listen } as unknown as ReturnType<typeof createApp>);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const once = vi.spyOn(process, 'once').mockImplementation(() => process);
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  return { database, server, listen, log, once, exit };
}

async function startAndShutDown(context: ReturnType<typeof setup>) {
  vi.useFakeTimers();
  await start();
  const shutdown = context.once.mock.calls[0][1];
  shutdown();
  expect(context.server.close).toHaveBeenCalledOnce();
  const [onClose] = context.server.close.mock.calls[0] as [() => Promise<void>];
  return onClose;
}

it('connects, initializes the schema, and listens on API_PORT', async () => {
  const { database, server, listen, log } = setup();
  const result = await start();
  expect(createDatabase).toHaveBeenCalledWith('postgresql://test');
  expect(database.$connect).toHaveBeenCalledOnce();
  expect(initialize).toHaveBeenCalledWith(database);
  expect(createApp).toHaveBeenCalledWith(database);
  expect(listen).toHaveBeenCalledWith(9123, '0.0.0.0', expect.any(Function));
  expect(log).toHaveBeenCalledWith('Taskly App Node API listening on port 8123');
  expect(result).toEqual({ server, database });
  expect(database.$disconnect).not.toHaveBeenCalled();
});
it('defaults to port 8000 when API_PORT is not set', async () => {
  const { listen } = setup('');
  await start();
  expect(listen).toHaveBeenCalledWith(8000, '0.0.0.0', expect.any(Function));
});
it('registers the same one-shot shutdown handler for SIGTERM and SIGINT', async () => {
  const { once } = setup();
  await start();
  expect(once).toHaveBeenCalledTimes(2);
  const [[firstSignal, first], [secondSignal, second]] = once.mock.calls;
  expect([firstSignal, secondSignal]).toEqual(['SIGTERM', 'SIGINT']);
  expect(first).toBeTypeOf('function');
  expect(second).toBe(first);
});
it('disconnects and rethrows when the server cannot listen', async () => {
  const { database, server, listen, once } = setup();
  const failure = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
  listen.mockImplementation(() => { queueMicrotask(() => server.emit('error', failure)); return server; });
  await expect(start()).rejects.toBe(failure);
  expect(database.$disconnect).toHaveBeenCalledOnce();
  expect(once).not.toHaveBeenCalled();
});
it.each([
  ['connecting', (context: ReturnType<typeof setup>) => context.database.$connect.mockRejectedValue(new Error('Database unavailable'))],
  ['initializing the schema', () => vi.mocked(initialize).mockRejectedValue(new Error('Database unavailable'))],
])('disconnects and rethrows when %s fails', async (step, fail) => {
  const context = setup();
  fail(context);
  await expect(start()).rejects.toThrow('Database unavailable');
  expect(context.database.$disconnect).toHaveBeenCalledOnce();
  expect(createApp).not.toHaveBeenCalled();
});
it('closes the server, then disconnects without forcing an exit', async () => {
  const context = setup();
  const onClose = await startAndShutDown(context);
  expect(context.database.$disconnect).not.toHaveBeenCalled();
  await onClose();
  expect(context.database.$disconnect).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(10_000);
  expect(context.exit).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(initialExitCode);
});
it('forces exit code 1 when the server does not close within 10 seconds', async () => {
  const context = setup();
  await startAndShutDown(context);
  vi.advanceTimersByTime(9_999);
  expect(context.exit).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(context.exit).toHaveBeenCalledWith(1);
  expect(context.database.$disconnect).not.toHaveBeenCalled();
});
it('logs disconnect failures during shutdown and sets a failing exit code', async () => {
  const context = setup();
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const failure = new Error('disconnect failed');
  context.database.$disconnect.mockRejectedValue(failure);
  const onClose = await startAndShutDown(context);
  await onClose();
  expect(error).toHaveBeenCalledWith(failure);
  expect(process.exitCode).toBe(1);
  vi.advanceTimersByTime(10_000);
  expect(context.exit).not.toHaveBeenCalled();
});
