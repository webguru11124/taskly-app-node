import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { createQueryWrapper } from '../../../test/query'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import type { Todo } from '../types'
import { useUpdateTodoMutation } from './useUpdateTodoMutation'

vi.mock('../api/todos', () => ({ todosApi: { update: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())

const other: Todo = { ...todoFixture, id: 8, title: 'Review the plan' }
const saved: Todo = { ...todoFixture, completed: true }
const change = { id: 7, input: { completed: true } }

function setup(cached?: Todo[]) {
  const { client, wrapper } = createQueryWrapper()
  if (cached) client.setQueryData<Todo[]>(todoKeys.list, cached)
  const { result } = renderHook(() => useUpdateTodoMutation(), { wrapper })
  return { client, result }
}

it('saves the changes and replaces the task in the cached list', async () => {
  vi.mocked(todosApi.update).mockResolvedValue(saved)
  const { client, result } = setup([todoFixture, other])
  const update = act(() => result.current.mutateAsync(change))
  await expect(update).resolves.toEqual(saved)
  expect(todosApi.update).toHaveBeenCalledWith(7, { completed: true })
  expect(client.getQueryData(todoKeys.list)).toEqual([saved, other])
})

it('does not create a list when no tasks were loaded yet', async () => {
  vi.mocked(todosApi.update).mockResolvedValue(saved)
  const { client, result } = setup()
  await act(() => result.current.mutateAsync(change))
  expect(client.getQueryData(todoKeys.list)).toBeUndefined()
})

it('exposes a failed update and leaves the cache untouched', async () => {
  vi.mocked(todosApi.update).mockRejectedValue(new Error('Not found.'))
  const { client, result } = setup([todoFixture, other])
  const update = result.current.mutateAsync(change)
  await expect(update).rejects.toThrow('Not found.')
  await waitFor(() => expect(result.current.error?.message).toBe('Not found.'))
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture, other])
})
