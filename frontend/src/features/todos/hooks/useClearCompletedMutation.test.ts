import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createQueryWrapper, deferred } from '../../../test/query'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import type { Todo } from '../types'
import { useClearCompletedMutation } from './useClearCompletedMutation'

vi.mock('../api/todos', () => ({ todosApi: { clearCompleted: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())

const done: Todo = { ...todoFixture, id: 8, title: 'Ship it', completed: true }
const alsoDone: Todo = { ...done, id: 9, title: 'Celebrate' }

function setup(cached?: Todo[]) {
  const { client, wrapper } = createQueryWrapper()
  if (cached) client.setQueryData<Todo[]>(todoKeys.list, cached)
  const { result } = renderHook(() => useClearCompletedMutation(), {
    wrapper,
  })
  return { client, result }
}

it('clears completed tasks and keeps only active ones in the cache', async () => {
  vi.mocked(todosApi.clearCompleted).mockResolvedValue({ deleted: 2 })
  const { client, result } = setup([done, todoFixture, alsoDone])
  await expect(act(() => result.current.mutateAsync())).resolves.toEqual({
    deleted: 2,
  })
  expect(todosApi.clearCompleted).toHaveBeenCalledTimes(1)
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})

it('does not create a list when no tasks were loaded yet', async () => {
  vi.mocked(todosApi.clearCompleted).mockResolvedValue({ deleted: 0 })
  const { client, result } = setup()
  await act(() => result.current.mutateAsync())
  expect(client.getQueryData(todoKeys.list)).toBeUndefined()
})

it('cancels list refetches before pruning the cache', async () => {
  vi.mocked(todosApi.clearCompleted).mockResolvedValue({ deleted: 1 })
  const { client, result } = setup([todoFixture, done])
  const cancel = vi.spyOn(client, 'cancelQueries')
  const write = vi.spyOn(client, 'setQueryData')
  await act(() => result.current.mutateAsync())
  expect(cancel).toHaveBeenCalledWith({ queryKey: todoKeys.list })
  expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(
    write.mock.invocationCallOrder[0],
  )
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})

it('exposes a failure and keeps every task cached', async () => {
  vi.mocked(todosApi.clearCompleted).mockRejectedValue(
    new Error('Could not clear.'),
  )
  const { client, result } = setup([todoFixture, done])
  await expect(result.current.mutateAsync()).rejects.toThrow('Could not clear.')
  await waitFor(() =>
    expect(result.current.error?.message).toBe('Could not clear.'),
  )
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture, done])
})

it('counts as a todos mutation while in flight so the page is busy', async () => {
  const request = deferred<{ deleted: number }>()
  vi.mocked(todosApi.clearCompleted).mockReturnValue(request.promise)
  const { client, result } = setup([todoFixture, done])
  let clearing!: Promise<unknown>
  act(() => {
    clearing = result.current.mutateAsync()
  })
  await waitFor(() =>
    expect(client.isMutating({ mutationKey: todoKeys.all })).toBe(1),
  )
  await act(async () => {
    request.resolve({ deleted: 1 })
    await clearing
  })
  expect(client.isMutating({ mutationKey: todoKeys.all })).toBe(0)
})
