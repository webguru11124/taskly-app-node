import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createQueryWrapper } from '../../../test/query'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import type { Todo } from '../types'
import { useDeleteTodoMutation } from './useDeleteTodoMutation'

vi.mock('../api/todos', () => ({ todosApi: { remove: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())

const other: Todo = { ...todoFixture, id: 8, title: 'Review the plan' }

function setup(cached?: Todo[]) {
  const { client, wrapper } = createQueryWrapper()
  if (cached) client.setQueryData<Todo[]>(todoKeys.list, cached)
  const { result } = renderHook(() => useDeleteTodoMutation(), { wrapper })
  return { client, result }
}

it('deletes the task and removes it from the cached list', async () => {
  vi.mocked(todosApi.remove).mockResolvedValue(undefined)
  const { client, result } = setup([todoFixture, other])
  await act(() => result.current.mutateAsync(7))
  expect(todosApi.remove).toHaveBeenCalledWith(7)
  expect(client.getQueryData(todoKeys.list)).toEqual([other])
})

it('does not create a list when no tasks were loaded yet', async () => {
  vi.mocked(todosApi.remove).mockResolvedValue(undefined)
  const { client, result } = setup()
  await act(() => result.current.mutateAsync(7))
  expect(client.getQueryData(todoKeys.list)).toBeUndefined()
})

it('exposes a failed deletion and keeps the task cached', async () => {
  vi.mocked(todosApi.remove).mockRejectedValue(new Error('Could not delete.'))
  const { client, result } = setup([todoFixture, other])
  const deletion = result.current.mutateAsync(7)
  await expect(deletion).rejects.toThrow('Could not delete.')
  await waitFor(() =>
    expect(result.current.error?.message).toBe('Could not delete.'),
  )
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture, other])
})
