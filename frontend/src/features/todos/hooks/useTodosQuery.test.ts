import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createQueryWrapper } from '../../../test/query'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useTodosQuery } from './useTodosQuery'

vi.mock('../api/todos', () => ({ todosApi: { list: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())

it('loads the tasks into the shared list cache', async () => {
  vi.mocked(todosApi.list).mockResolvedValue([todoFixture])
  const { client, wrapper } = createQueryWrapper()
  const { result } = renderHook(() => useTodosQuery(), { wrapper })
  expect(result.current.isPending).toBe(true)
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(result.current.data).toEqual([todoFixture])
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
  expect(todosApi.list).toHaveBeenCalledTimes(1)
})

it('exposes a failed request as an error', async () => {
  vi.mocked(todosApi.list).mockRejectedValue(
    new Error('The server is unavailable.'),
  )
  const { wrapper } = createQueryWrapper()
  const { result } = renderHook(() => useTodosQuery(), { wrapper })
  await waitFor(() => expect(result.current.isError).toBe(true))
  expect(result.current.error?.message).toBe('The server is unavailable.')
  expect(result.current.data).toBeUndefined()
})

it('aborts the request when the page stops using it', async () => {
  vi.mocked(todosApi.list).mockReturnValue(new Promise(() => {}))
  const { wrapper } = createQueryWrapper()
  const { unmount } = renderHook(() => useTodosQuery(), { wrapper })
  await waitFor(() => expect(todosApi.list).toHaveBeenCalledTimes(1))
  const [signal] = vi.mocked(todosApi.list).mock.calls[0]
  expect(signal).toBeInstanceOf(AbortSignal)
  expect(signal?.aborted).toBe(false)
  unmount()
  expect(signal?.aborted).toBe(true)
})
