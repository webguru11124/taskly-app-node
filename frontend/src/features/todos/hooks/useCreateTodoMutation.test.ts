import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createQueryWrapper, deferred } from '../../../test/query'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import type { Todo, TodoInput } from '../types'
import { useCreateTodoMutation } from './useCreateTodoMutation'

vi.mock('../api/todos', () => ({ todosApi: { create: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())

const input: TodoInput = {
  title: 'Write tests',
  description: 'Cover the hooks',
  priority: 'high',
  due_date: '2026-10-20',
  completed: false,
}
const saved: Todo = { ...todoFixture, ...input, id: 8 }

function setup(cached?: Todo[]) {
  const { client, wrapper } = createQueryWrapper()
  if (cached) client.setQueryData<Todo[]>(todoKeys.list, cached)
  const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
  return { client, result }
}

it('creates the task and puts it first in the cached list', async () => {
  vi.mocked(todosApi.create).mockResolvedValue(saved)
  const { client, result } = setup([todoFixture])
  const creation = act(() => result.current.mutateAsync(input))
  await expect(creation).resolves.toEqual(saved)
  expect(todosApi.create).toHaveBeenCalledWith(input)
  expect(client.getQueryData(todoKeys.list)).toEqual([saved, todoFixture])
})

it('replaces a cached copy of the saved task instead of duplicating it', async () => {
  vi.mocked(todosApi.create).mockResolvedValue(saved)
  const other = { ...todoFixture, id: 3 }
  const { client, result } = setup([other, { ...saved, title: 'Draft' }])
  await act(() => result.current.mutateAsync(input))
  expect(client.getQueryData(todoKeys.list)).toEqual([saved, other])
})

it('starts the cached list when no tasks were loaded yet', async () => {
  vi.mocked(todosApi.create).mockResolvedValue(saved)
  const { client, result } = setup()
  await act(() => result.current.mutateAsync(input))
  expect(client.getQueryData(todoKeys.list)).toEqual([saved])
})

it('does not let an older list fetch overwrite the created task', async () => {
  vi.mocked(todosApi.create).mockResolvedValue(saved)
  const { client, result } = setup([todoFixture])
  const staleFetch = deferred<Todo[]>()
  void client.prefetchQuery({
    queryKey: todoKeys.list,
    queryFn: () => staleFetch.promise,
  })
  await act(() => result.current.mutateAsync(input))
  await act(async () => staleFetch.resolve([]))
  expect(client.getQueryData(todoKeys.list)).toEqual([saved, todoFixture])
})

it('exposes a failed creation and leaves the cache untouched', async () => {
  vi.mocked(todosApi.create).mockRejectedValue(new Error('Could not save.'))
  const { client, result } = setup([todoFixture])
  const creation = result.current.mutateAsync(input)
  await expect(creation).rejects.toThrow('Could not save.')
  await waitFor(() =>
    expect(result.current.error?.message).toBe('Could not save.'),
  )
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})
